/**
 * Fetch HUST_Solfege (solo solfège singing, 73 usable recordings) into the eval
 * harness's real corpus layout.
 *
 * Output: scripts/fixtures/eval-real/hust-solfege/<clip>.truth.json
 *         scripts/fixtures/eval-real/hust-solfege/<clip>__real.wav
 *         scripts/fixtures/eval-real/hust-solfege/dataset.json
 *
 * Source : https://github.com/itec-hust/HUST_Solfege
 * License: MIT (LICENSE at the repo root — the published grant governs, per the
 *          acquisition policy in research-voice-datasets.md §policy).
 *
 * ## What is used and what is not
 *
 * The repo holds 103 recordings: 73 self-built solfège recordings (numeric
 * basenames) and 30 re-hosted MARG files (man1..6, woman1..3). Only the 73
 * numeric files are converted, for DATA reasons, not licence ones: the README states
 * "Pitch notations are not done for MARG recordings" (their pitch column is
 * populated but meaningless), and they follow a different pitch convention.
 *
 * ## The pitch convention, measured
 *
 * The annotation's pitch column is NOT MIDI: values span 22.8–63.96, i.e. a
 * constant ~20 semitones below the sung pitch. Calibrated against the audio
 * itself (autocorrelation f0 at each annotated onset, 73/73 files, 1,230 notes):
 * the offset is ~+19.77 GLOBALLY but drifts per file (per-file medians
 * 19.43–20.03) — consistent with a per-file tuning reference, not a constant.
 * This fetcher therefore calibrates the offset PER FILE (median over sampled
 * notes, ±50-cent-robust) and falls back to the global constant when a file
 * yields too few voiced measurements. One scalar per file estimated from ~30
 * notes cannot leak our estimator's per-note behaviour into the truth, so the
 * harness's annotation-provenance bar is satisfied.
 *
 * ## Offsets are synthetic in the source
 *
 * Every offset in the source annotation is exactly onset + 0.03 s (documented in
 * research-voice-datasets.md §1d). Durations here are therefore DERIVED as the
 * gap to the next onset (clamped); onset+pitch metrics (the headline) are
 * unaffected, but overlap-based counters (split/merged) read the derived
 * durations — treat those as approximate for this dataset.
 *
 * Idempotent. Run: pnpm --filter @mushee/api exec tsx scripts/eval/fetch-hust-solfege.ts
 */

import { execFileSync } from 'child_process';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'fs';
import { join, resolve } from 'path';

import type { GroundTruth, TruthNote } from './types';

const AUDIO_URL =
  'https://media.githubusercontent.com/media/itec-hust/HUST_Solfege/master/wav/HUST_Solfege.zip';
const REPO_TARBALL = 'https://codeload.github.com/itec-hust/HUST_Solfege/tar.gz/master';

const CACHE = resolve(__dirname, '.cache');
const AUDIO_ZIP = join(CACHE, 'hust-solfege-audio.zip');
const REPO_TGZ = join(CACHE, 'hust-solfege-repo.tar.gz');
const EXTRACT = join(CACHE, 'hust-solfege');
const OUT = resolve(__dirname, '../fixtures/eval-real/hust-solfege');

const NOMINAL_BPM = 120;
/** Global fallback offset (semitones), measured over all 73 files / 1,230 notes. */
const GLOBAL_OFFSET = 19.77;
/** Per-file calibration needs at least this many voiced measurements to be used. */
const MIN_CALIBRATION_NOTES = 8;

function fetchFile(url: string, dest: string, label: string): void {
  if (existsSync(dest)) {
    console.log(`  already cached: ${dest}`);
    return;
  }
  mkdirSync(CACHE, { recursive: true });
  console.log(`  downloading ${label} …`);
  execFileSync('curl', ['-sL', '--fail', '--max-time', '1800', '-o', dest, url], {
    stdio: ['ignore', 'ignore', 'inherit'],
  });
}

function extractAll(): { wavDir: string; annDir: string } {
  const wavDir = join(EXTRACT, 'HUST_Solfege');
  if (!existsSync(wavDir)) {
    mkdirSync(EXTRACT, { recursive: true });
    execFileSync('unzip', ['-oq', AUDIO_ZIP, '-d', EXTRACT], {
      stdio: ['ignore', 'ignore', 'inherit'],
    });
  }
  const repoDir = join(EXTRACT, 'repo');
  if (!existsSync(repoDir)) {
    mkdirSync(repoDir, { recursive: true });
    execFileSync('tar', ['xzf', REPO_TGZ, '-C', repoDir, '--strip-components', '1'], {
      stdio: ['ignore', 'ignore', 'inherit'],
    });
  }
  return { wavDir, annDir: join(repoDir, 'onset&pitch') };
}

/** Minimal PCM16 mono WAV reader (chunk-walking, no dependencies). */
function readWav(path: string): { samples: Int16Array; sampleRate: number } {
  const buf = readFileSync(path);
  if (buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') {
    throw new Error(`not a RIFF/WAVE file: ${path}`);
  }
  let pos = 12;
  let sampleRate = 0;
  let channels = 1;
  let bits = 16;
  while (pos + 8 <= buf.length) {
    const id = buf.toString('ascii', pos, pos + 4);
    const size = buf.readUInt32LE(pos + 4);
    if (id === 'fmt ') {
      channels = buf.readUInt16LE(pos + 10);
      sampleRate = buf.readUInt32LE(pos + 12);
      bits = buf.readUInt16LE(pos + 22);
    } else if (id === 'data') {
      if (bits !== 16) throw new Error(`expected 16-bit PCM, got ${bits}: ${path}`);
      const n = Math.floor(size / 2 / channels);
      const samples = new Int16Array(n);
      for (let i = 0; i < n; i += 1) {
        samples[i] = buf.readInt16LE(pos + 8 + i * 2 * channels); // first channel
      }
      return { samples, sampleRate };
    }
    pos += 8 + size + (size % 2);
  }
  throw new Error(`no data chunk: ${path}`);
}

/**
 * Autocorrelation f0 (Hz) of `x`, 55–1200 Hz band, parabolic lag refinement.
 * Coarse but unbiased — it only ever feeds a MEDIAN over dozens of notes.
 */
function acfF0(x: Int16Array, sampleRate: number): number | null {
  let power = 0;
  for (let i = 0; i < x.length; i += 1) power += x[i] * x[i];
  if (power < 1e4) return null;
  const minLag = Math.floor(sampleRate / 1200);
  const maxLag = Math.min(Math.floor(sampleRate / 55), x.length - 1);
  const ac = (lag: number): number => {
    let r = 0;
    for (let i = 0; i + lag < x.length; i += 4) r += x[i] * x[i + lag];
    return r;
  };
  let best = 0;
  let bestR = 0;
  for (let lag = minLag; lag <= maxLag; lag += 1) {
    const r = ac(lag);
    if (r > bestR) {
      bestR = r;
      best = lag;
    }
  }
  if (!best) return null;
  let lag = best;
  if (best > minLag && best < maxLag) {
    const a = ac(best - 1);
    const b = bestR;
    const c = ac(best + 1);
    const denom = a - 2 * b + c;
    if (denom !== 0) lag = best + (0.5 * (a - c)) / denom;
  }
  return sampleRate / lag;
}

interface AnnRow {
  onsetSec: number;
  pitch: number; // the source's own convention, NOT midi
}

function parseAnnotation(path: string): AnnRow[] {
  const rows: AnnRow[] = [];
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const parts = line.trim().split(/\s+/);
    if (parts.length < 3) continue;
    const [onset, , pitch] = parts.map(Number);
    if (!Number.isFinite(onset) || !Number.isFinite(pitch)) continue;
    rows.push({ onsetSec: onset, pitch });
  }
  rows.sort((a, b) => a.onsetSec - b.onsetSec);
  return rows;
}

/**
 * Per-file pitch-convention offset: median of (measured midi − annotated pitch)
 * over up to ~40 sampled notes. Measurements outside [17, 23] are discarded as
 * octave errors of the calibration estimator itself.
 */
function calibrateOffset(
  wav: { samples: Int16Array; sampleRate: number },
  rows: AnnRow[],
): { offset: number; n: number } {
  const sr = wav.sampleRate;
  const step = Math.max(1, Math.floor(rows.length / 40));
  const diffs: number[] = [];
  for (let i = 0; i < rows.length; i += step) {
    const start = Math.floor((rows[i].onsetSec + 0.06) * sr);
    const len = Math.floor(0.12 * sr);
    if (start < 0 || start + len >= wav.samples.length) continue;
    const f0 = acfF0(wav.samples.subarray(start, start + len), sr);
    if (!f0) continue;
    const midi = 69 + 12 * Math.log2(f0 / 440);
    const d = midi - rows[i].pitch;
    if (d > 17 && d < 23) diffs.push(d);
  }
  if (diffs.length < MIN_CALIBRATION_NOTES) return { offset: GLOBAL_OFFSET, n: diffs.length };
  diffs.sort((a, b) => a - b);
  return { offset: diffs[Math.floor(diffs.length / 2)], n: diffs.length };
}

/** Durations derived from inter-onset gaps; the source's offsets are synthetic. */
function toTruthNotes(rows: AnnRow[], offset: number): TruthNote[] {
  const durs: number[] = [];
  for (let i = 0; i + 1 < rows.length; i += 1) {
    durs.push(rows[i + 1].onsetSec - rows[i].onsetSec - 0.03);
  }
  const sorted = [...durs].sort((a, b) => a - b);
  const medianDur = sorted.length ? sorted[Math.floor(sorted.length / 2)] : 0.4;
  return rows.map((r, i) => ({
    onsetSec: r.onsetSec,
    durSec: Math.min(2, Math.max(0.06, i < durs.length ? durs[i] : medianDur)),
    midi: Math.round(r.pitch + offset),
  }));
}

function main(): void {
  fetchFile(AUDIO_URL, AUDIO_ZIP, 'HUST_Solfege audio (~273 MB, Git-LFS)');
  fetchFile(REPO_TARBALL, REPO_TGZ, 'HUST_Solfege annotations (repo tarball)');
  const { wavDir, annDir } = extractAll();

  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });

  // Numeric basenames only: the 73 self-built solfège recordings. The 30 MARG
  // files (man*/woman*) have no usable pitch annotation (README) and are skipped.
  const clipsIds = readdirSync(annDir)
    .filter((f) => /^\d+\.txt$/.test(f))
    .map((f) => f.replace('.txt', ''))
    .sort((a, b) => Number(a) - Number(b));

  let clips = 0;
  let totalNotes = 0;
  let fallbacks = 0;
  const offsets: number[] = [];
  for (const id of clipsIds) {
    const wavPath = join(wavDir, `${id}.wav`);
    if (!existsSync(wavPath)) {
      console.warn(`  ! ${id}: audio missing, skipping`);
      continue;
    }
    const rows = parseAnnotation(join(annDir, `${id}.txt`));
    if (rows.length < 5) {
      console.warn(`  ! ${id}: too few annotation rows, skipping`);
      continue;
    }
    const wav = readWav(wavPath);
    const { offset, n } = calibrateOffset(wav, rows);
    if (n < MIN_CALIBRATION_NOTES) fallbacks += 1;
    offsets.push(offset);

    const notes = toTruthNotes(rows, offset);
    const truth: GroundTruth = { bpm: NOMINAL_BPM, notes };
    const clip = `hust_${id}`;
    writeFileSync(join(OUT, `${clip}.truth.json`), JSON.stringify(truth, null, 2));
    copyFileSync(wavPath, join(OUT, `${clip}__real.wav`));
    clips += 1;
    totalNotes += notes.length;
  }

  offsets.sort((a, b) => a - b);
  const manifest = {
    id: 'hust-solfege',
    label: 'HUST_Solfege (real solo solfège, onsets + calibrated pitch)',
    kind: 'voice',
    instrumentId: 'voice-lead',
    source: 'https://github.com/itec-hust/HUST_Solfege',
    license: 'MIT',
    bpmAssumed: NOMINAL_BPM,
    // The source's offsets are synthetic (onset + 0.03 s); durations here are
    // derived from inter-onset gaps. Overlap-based counters are approximate.
    durationsDerived: true,
    pitchOffsetMedian: offsets.length ? offsets[Math.floor(offsets.length / 2)] : null,
    pitchOffsetFallbacks: fallbacks,
    clips,
    totalNotes,
  };
  writeFileSync(join(OUT, 'dataset.json'), JSON.stringify(manifest, null, 2));
  console.log(
    `\nConverted ${clips} HUST_Solfege clips (${totalNotes} notes, ` +
      `${fallbacks} offset fallbacks) into ${OUT}`,
  );
}

main();
