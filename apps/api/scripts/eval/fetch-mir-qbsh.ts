/**
 * Fetch the MIR-QBSH (Roger Jang / NTU MIR Lab) query-by-singing/humming corpus
 * and convert a CLEAN SUBSET of its queries into the eval harness's *real*
 * corpus layout, so run-eval can score the pipeline against actual sung/hummed
 * human voices (low-fi, 8 kHz) alongside the studio-quality vocadito set.
 *
 * Output: scripts/fixtures/eval-real/mir-qbsh/<clip>.truth.json  ({bpm, notes})
 *         scripts/fixtures/eval-real/mir-qbsh/<clip>__real.wav
 *         scripts/fixtures/eval-real/mir-qbsh/dataset.json        (manifest)
 *
 * Source : http://mirlab.org/dataSet/public/MIR-QBSH.zip
 *          (the directory listing at http://mirlab.org/dataSet/public/ ships the
 *          corpus as MIR-QBSH.zip; the .rar URL cited in the corpus readme is no
 *          longer served, and the host only answers on plain HTTP, not HTTPS.)
 * License: academic/research use (cite Jyh-Shing Roger Jang, "MIR-QBSH Corpus").
 *
 * Corpus format (per the bundled index.htm, the authoritative doc):
 *   waveFile/<year>/<person>/NNNNN.wav  — 8 kHz, 8-bit, mono RIFF/WAVE
 *   waveFile/<year>/<person>/NNNNN.pv   — one manually-labelled pitch per frame,
 *     in semitone / MIDI units, frame size = 256 samples, overlap = 0, the first
 *     frame starting at the first audio sample. 0 (or any non-positive value)
 *     marks an unvoiced / silent frame.
 *
 *   => frameSec = 256 / 8000 = 0.032 s. Verified empirically: a 64044-byte 8-bit
 *      wav (~64000 data bytes) has exactly 250 frames in its .pv, i.e. 256
 *      samples per frame.
 *
 * Note segmentation (frame pitch -> notes):
 *   Round each voiced frame to its nearest integer MIDI semitone, then group
 *   maximal runs of consecutive frames that share the same integer. Unvoiced
 *   frames break a run (the gap is dropped, not bridged). A run must be at least
 *   MIN_RUN_FRAMES long (3 frames = 96 ms) to survive — this discards portamento
 *   glitches and single-frame labeling noise. For each surviving run:
 *     onsetSec = firstFrameIndex * frameSec
 *     durSec   = runFrames        * frameSec
 *     midi     = the integer semitone
 *
 * Subset: the full corpus has 4431 queries; we convert only a clean subset of
 * ~50 (see SUBSET_TARGET). Clips are ranked by a heuristic that prefers a high
 * voiced-frame ratio, a plausible vocal register, and a melody that segments
 * into several stable notes rather than a smear of fragments; the top N are kept.
 * Audio is copied verbatim (already WAV), so no .pcm transcode is needed here —
 * the ffmpeg-static fallback below is kept only in case a future corpus revision
 * ships headerless 8 kHz mono 16-bit .pcm files.
 *
 * The 145 MB zip and its extracted tree are cached (gitignored) under
 * scripts/eval/.cache and re-converted on each run; only this script is tracked.
 *
 * Idempotent. Run: pnpm --filter api exec tsx scripts/eval/fetch-mir-qbsh.ts
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
import { resolve, join } from 'path';

import ffmpegPath from 'ffmpeg-static';

import type { GroundTruth, TruthNote } from './types';

const ZIP_URL = 'http://mirlab.org/dataSet/public/MIR-QBSH.zip';

const CACHE = resolve(__dirname, '.cache', 'mir-qbsh');
const ZIP = join(CACHE, 'MIR-QBSH.zip');
// The zip unpacks to a top-level "MIR-QBSH" directory.
const ROOT = join(CACHE, 'MIR-QBSH');
const WAVE_ROOT = join(ROOT, 'waveFile');
const OUT = resolve(__dirname, '../fixtures/eval-real/mir-qbsh');

// 256-sample frames at the corpus's fixed 8 kHz sampling rate, overlap 0.
const FRAME_SEC = 256 / 8000; // 0.032 s

// A note must span at least this many frames (3 * 32 ms = 96 ms) to be kept;
// shorter same-pitch runs are treated as labeling/portamento glitches.
const MIN_RUN_FRAMES = 3;

// Queries are free, un-metered singing/humming with no annotated tempo. bpm is
// only handed to the converter's quantizer; the metrics compare onsets in
// seconds, so this value does not affect scoring.
const NOMINAL_BPM = 120;

// How many clean queries to convert out of the 4431 in the corpus.
const SUBSET_TARGET = 50;

// Plausible sung/hummed vocal register (semitones). Used both to drop garbage
// frames and to score a clip's cleanliness.
const MIN_MIDI = 40;
const MAX_MIDI = 76;

function download(): void {
  if (existsSync(ZIP)) {
    console.log(`  zip already cached: ${ZIP}`);
    return;
  }
  mkdirSync(CACHE, { recursive: true });
  console.log('  downloading MIR-QBSH.zip (~145 MB) …');
  // mirlab.org only answers on plain HTTP (port 443 times out), so no -L upgrade.
  execFileSync('curl', ['-sL', '--fail', '--max-time', '1200', '-o', ZIP, ZIP_URL], {
    stdio: ['ignore', 'ignore', 'inherit'],
  });
}

function extract(): void {
  if (existsSync(WAVE_ROOT)) {
    console.log(`  already extracted: ${ROOT}`);
    return;
  }
  execFileSync('unzip', ['-oq', ZIP, '-d', CACHE, '-x', '__MACOSX/*'], {
    stdio: ['ignore', 'ignore', 'inherit'],
  });
}

/** Recursively collect every NNNNN.pv path under the waveFile tree. */
function listPvFiles(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, entry.name);
      if (entry.isDirectory()) walk(p);
      else if (entry.name.endsWith('.pv')) out.push(p);
    }
  };
  walk(root);
  return out;
}

/** Read a .pv file into one float (MIDI semitone) per frame; <=0 = unvoiced. */
function readFramePitches(pvPath: string): number[] {
  return readFileSync(pvPath, 'utf8')
    .trim()
    .split(/\s+/)
    .filter((t) => t.length > 0)
    .map(Number);
}

/**
 * Group consecutive voiced frames that round to the same integer MIDI into
 * notes. Unvoiced frames (pitch <= 0) and pitch changes break a run; runs
 * shorter than MIN_RUN_FRAMES are dropped as glitches.
 */
function framesToNotes(frames: number[]): TruthNote[] {
  const notes: TruthNote[] = [];

  let runMidi: number | null = null;
  let runStart = 0;
  let runLen = 0;

  const flush = (): void => {
    if (runMidi !== null && runLen >= MIN_RUN_FRAMES) {
      notes.push({
        onsetSec: runStart * FRAME_SEC,
        durSec: runLen * FRAME_SEC,
        midi: runMidi,
      });
    }
    runMidi = null;
    runLen = 0;
  };

  for (let i = 0; i < frames.length; i++) {
    const hz = frames[i];
    const voiced = Number.isFinite(hz) && hz > 0;
    const midi = voiced ? Math.round(hz) : null;
    if (midi !== null && midi === runMidi) {
      runLen += 1;
    } else {
      flush();
      if (midi !== null) {
        runMidi = midi;
        runStart = i;
        runLen = 1;
      }
    }
  }
  flush();

  notes.sort((a, b) => a.onsetSec - b.onsetSec);
  return notes;
}

interface Candidate {
  /** Stable, filesystem-safe clip id, e.g. year2006a_person00001_00001. */
  id: string;
  wav: string;
  pcm?: string;
  notes: TruthNote[];
  /** Higher = cleaner. */
  score: number;
}

/**
 * Score a clip's cleanliness. Prefer many stable notes in a plausible vocal
 * register with a high voiced-frame ratio. Reject clips that are clearly out of
 * range, too sparse, or barely voiced.
 */
function evaluate(pvPath: string): Candidate | null {
  const frames = readFramePitches(pvPath);
  if (frames.length < 32) return null; // < ~1 s of audio

  const voiced = frames.filter((p) => Number.isFinite(p) && p > 0);
  if (voiced.length === 0) return null;
  const voicedRatio = voiced.length / frames.length;

  const medianMidi = [...voiced].sort((a, b) => a - b)[Math.floor(voiced.length / 2)];
  if (medianMidi < MIN_MIDI || medianMidi > MAX_MIDI) return null;

  const notes = framesToNotes(frames).filter((n) => n.midi >= MIN_MIDI && n.midi <= MAX_MIDI);
  if (notes.length < 5) return null; // need a real melody, not a couple of blips

  // Mean note length in frames — very short mean = fragmented / unstable label.
  const meanRunFrames =
    notes.reduce((s, n) => s + n.durSec / FRAME_SEC, 0) / notes.length;

  // Fraction of the original voiced frames that survived segmentation: a clean,
  // stable melody keeps most of its voiced frames; a smeary one loses many to
  // the min-run filter.
  const keptFrames = notes.reduce((s, n) => s + n.durSec / FRAME_SEC, 0);
  const keptRatio = keptFrames / voiced.length;

  const score =
    voicedRatio * 2 + // mostly-voiced clips are cleaner
    keptRatio * 2 + // little lost to glitch filtering
    Math.min(meanRunFrames, 12) / 12 + // reasonably sustained notes
    Math.min(notes.length, 30) / 30; // a melody with substance

  const rel = pvPath.slice(WAVE_ROOT.length + 1, -'.pv'.length); // year/person/NNNNN
  const id = rel.replace(/[\\/]/g, '_');
  const wav = pvPath.replace(/\.pv$/, '.wav');
  const pcm = pvPath.replace(/\.pv$/, '.pcm');

  return { id, wav, pcm: existsSync(pcm) ? pcm : undefined, notes, score };
}

/**
 * Materialize a clip's audio as WAV. MIR-QBSH already ships real 8 kHz mono
 * WAV, so the common case is a verbatim copy. The .pcm branch (headerless 8 kHz
 * mono 16-bit) is a safety net for future corpus revisions and uses bundled
 * ffmpeg.
 */
function writeWav(c: Candidate, dest: string): void {
  if (existsSync(c.wav)) {
    copyFileSync(c.wav, dest);
    return;
  }
  if (c.pcm) {
    if (!ffmpegPath) throw new Error('ffmpeg-static binary not available for .pcm transcode');
    execFileSync(
      ffmpegPath,
      ['-y', '-f', 's16le', '-ar', '8000', '-ac', '1', '-i', c.pcm, dest],
      { stdio: ['ignore', 'ignore', 'inherit'] },
    );
    return;
  }
  throw new Error(`no audio for ${c.id}`);
}

function main(): void {
  download();
  extract();

  console.log('  scanning .pv files for clean queries …');
  const pvFiles = listPvFiles(WAVE_ROOT);
  console.log(`  found ${pvFiles.length} .pv files`);

  const candidates: Candidate[] = [];
  for (const pv of pvFiles) {
    if (!existsSync(pv.replace(/\.pv$/, '.wav')) && !existsSync(pv.replace(/\.pv$/, '.pcm'))) {
      continue;
    }
    const c = evaluate(pv);
    if (c) candidates.push(c);
  }
  console.log(`  ${candidates.length} clips passed the cleanliness gate`);

  candidates.sort((a, b) => b.score - a.score);
  const chosen = candidates.slice(0, SUBSET_TARGET);

  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });

  let clips = 0;
  let totalNotes = 0;
  for (const c of chosen) {
    const truth: GroundTruth = { bpm: NOMINAL_BPM, notes: c.notes };
    writeFileSync(join(OUT, `${c.id}.truth.json`), JSON.stringify(truth, null, 2));
    writeWav(c, join(OUT, `${c.id}__real.wav`));
    clips += 1;
    totalNotes += c.notes.length;
  }

  const manifest = {
    id: 'mir-qbsh',
    label: 'MIR-QBSH (real sung/hummed queries, clean subset)',
    kind: 'voice',
    instrumentId: 'voice-lead',
    source: 'http://mirlab.org/dataSet/public/MIR-QBSH.zip',
    license: 'academic/research',
    clips,
    totalNotes,
    notes:
      `Clean subset of ${clips}/${pvFiles.length} queries. Low-fi 8 kHz/8-bit mono audio, ` +
      'sung and hummed nursery rhymes by ~195 subjects. Ground truth derived from the ' +
      'corpus .pv frame-pitch labels (256-sample frames @ 8 kHz = 0.032 s/frame, semitone ' +
      'units, 0 = unvoiced): same-integer-MIDI runs of >=3 frames become notes, unvoiced ' +
      'gaps break runs. Subset ranked by voiced ratio, vocal register, and note stability.',
  };
  writeFileSync(join(OUT, 'dataset.json'), JSON.stringify(manifest, null, 2));

  console.log(
    `\nConverted ${clips} MIR-QBSH clips (${totalNotes} notes) into ${OUT}` +
      `\n(clean subset of ${pvFiles.length} corpus queries; frameSec=${FRAME_SEC})`,
  );
  console.log(
    'Run: EVAL_REAL=1 EVAL_ADAPTIVE=1 pnpm --filter api exec tsx scripts/eval/run-eval.ts',
  );
}

main();
