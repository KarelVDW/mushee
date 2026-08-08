/**
 * Fetch the Choral Singing Dataset (CSD, MTG/UPF) and convert per-singer stems
 * into the eval harness's real corpus layout.
 *
 * Output: scripts/fixtures/eval-real/csd/<clip>.truth.json
 *         scripts/fixtures/eval-real/csd/<clip>__real.wav
 *         scripts/fixtures/eval-real/csd/dataset.json
 *
 * Source : https://zenodo.org/records/2649950  (1.07 GB zip)
 * License: CC-BY-4.0 (the record's own licence field; first-party MTG deposit).
 *          Adopted per the acquisition policy in research-voice-datasets.md.
 *
 * ## What this corpus is
 *
 * 16 singers of the Anton Bruckner Choir (Barcelona), three a cappella pieces
 * (El Rossinyol, Locus Iste, Niño Dios), recorded in groups of four per SATB
 * section with an individual cardioid close mic per singer. Note annotations
 * (`*_notes.lab`: onset s · mean-f0 Hz · duration s) were extracted with Tony
 * and MANUALLY CORRECTED — measured pitch, not score pitch (identical written
 * notes carry different frequencies), which is what clears the harness's
 * annotation-provenance bar.
 *
 * ## Two caveats, carried into every result
 *
 * - **Notes are per SECTION, not per singer** ("only one note file is generated
 *   for each section because note boundaries are very similar"). Every singer's
 *   stem is scored against their section's notes, so individual timing deviation
 *   within a section is invisible — a real ceiling for onset metrics here.
 * - **Bleed**: the singers recorded simultaneously; close mics pick up
 *   neighbours. That is a genuine (and realistic) adverse condition for a
 *   monophonic tracker. It lives in its own dataset dir precisely so it is
 *   never silently mixed into a clean-condition read.
 *
 * ## Excerpting
 *
 * Stems are ~4.5 minutes; the harness's other real clips are 15–40 s and the
 * bootstrap resamples clips, so each stem is cut into up to two 30 s excerpts
 * chosen (deterministically) where the section's note density is highest.
 *
 * Idempotent. Run: pnpm --filter @mushee/api exec tsx scripts/eval/fetch-csd.ts
 */

import { execFileSync } from 'child_process';
import ffmpegPath from 'ffmpeg-static';
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'fs';
import { join, resolve } from 'path';

import { hzToMidi } from './lib/groundTruth';
import type { GroundTruth, TruthNote } from './types';

const ZIP_URL =
  'https://zenodo.org/api/records/2649950/files/ChoralSingingDataset.zip/content';

const CACHE = resolve(__dirname, '.cache');
const ZIP = join(CACHE, 'csd.zip');
const EXTRACT = join(CACHE, 'csd');
const OUT = resolve(__dirname, '../fixtures/eval-real/csd');

const NOMINAL_BPM = 120; // metrics compare seconds; bpm only feeds the quantizer
const WINDOW_SEC = 30;
const WINDOWS_PER_STEM = 2;
const MIN_NOTES_PER_WINDOW = 8;
/** Notes shorter than this after clamping to the window are dropped as slivers. */
const MIN_CLIPPED_DUR_SEC = 0.05;

function download(): void {
  if (existsSync(ZIP)) {
    console.log(`  zip already cached: ${ZIP}`);
    return;
  }
  mkdirSync(CACHE, { recursive: true });
  console.log('  downloading ChoralSingingDataset.zip (~1.07 GB) …');
  execFileSync('curl', ['-sL', '--fail', '--max-time', '3600', '-o', ZIP, ZIP_URL], {
    stdio: ['ignore', 'ignore', 'inherit'],
  });
}

function extract(): void {
  if (existsSync(join(EXTRACT, 'ChoralSingingDataset'))) {
    console.log(`  already extracted: ${EXTRACT}`);
    return;
  }
  mkdirSync(EXTRACT, { recursive: true });
  execFileSync('unzip', ['-oq', ZIP, '-d', EXTRACT, '-x', '__MACOSX/*'], {
    stdio: ['ignore', 'ignore', 'inherit'],
  });
}

/** Parse a `_notes.lab`: whitespace-separated `onset_s  mean_f0_Hz  duration_s`. */
function parseLab(path: string): TruthNote[] {
  const notes: TruthNote[] = [];
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const parts = line.trim().split(/\s+/);
    if (parts.length < 3) continue;
    const [onsetSec, hz, durSec] = parts.map(Number);
    if (!Number.isFinite(hz) || hz <= 0 || !Number.isFinite(onsetSec)) continue;
    notes.push({ onsetSec, durSec, midi: Math.round(hzToMidi(hz)) });
  }
  notes.sort((a, b) => a.onsetSec - b.onsetSec);
  return notes;
}

/**
 * Deterministic excerpt windows: slide a WINDOW_SEC window in 5 s steps over the
 * section's note timeline, score each start by contained notes, then greedily
 * take the densest non-overlapping windows.
 */
function pickWindows(notes: TruthNote[]): number[] {
  const last = notes[notes.length - 1];
  const span = last.onsetSec + last.durSec;
  const starts: { start: number; count: number }[] = [];
  for (let s = 0; s + WINDOW_SEC <= span; s += 5) {
    const count = notes.filter(
      (n) => n.onsetSec >= s && n.onsetSec + n.durSec <= s + WINDOW_SEC,
    ).length;
    starts.push({ start: s, count });
  }
  starts.sort((a, b) => b.count - a.count || a.start - b.start);
  const chosen: number[] = [];
  for (const c of starts) {
    if (c.count < MIN_NOTES_PER_WINDOW) break;
    if (chosen.some((s) => Math.abs(s - c.start) < WINDOW_SEC)) continue;
    chosen.push(c.start);
    if (chosen.length === WINDOWS_PER_STEM) break;
  }
  return chosen.sort((a, b) => a - b);
}

/** Notes inside `[start, start+WINDOW_SEC)`, re-based to the window. */
function windowNotes(notes: TruthNote[], start: number): TruthNote[] {
  const end = start + WINDOW_SEC;
  const out: TruthNote[] = [];
  for (const n of notes) {
    if (n.onsetSec < start || n.onsetSec >= end - 0.2) continue;
    const dur = Math.min(n.durSec, end - n.onsetSec);
    if (dur < MIN_CLIPPED_DUR_SEC) continue;
    out.push({ onsetSec: n.onsetSec - start, durSec: dur, midi: n.midi });
  }
  return out;
}

/** Write `[startSec, startSec + WINDOW_SEC)` of `src` as mono 16-bit WAV. */
function writeWindowWav(src: string, startSec: number, dest: string): void {
  if (!ffmpegPath) throw new Error('ffmpeg-static binary not available');
  execFileSync(
    ffmpegPath,
    [
      '-hide_banner', '-loglevel', 'error', '-y',
      '-i', src,
      // -ss after -i: decode-accurate seek, so truth and audio agree to the sample.
      '-ss', startSec.toFixed(6),
      '-t', WINDOW_SEC.toFixed(6),
      '-ac', '1',
      '-c:a', 'pcm_s16le',
      dest,
    ],
    { stdio: ['ignore', 'ignore', 'inherit'] },
  );
}

function main(): void {
  download();
  extract();
  const dir = join(EXTRACT, 'ChoralSingingDataset');

  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });

  const labFiles = readdirSync(dir).filter((f) => f.endsWith('_notes.lab'));
  let clips = 0;
  let totalNotes = 0;
  for (const lab of labFiles.sort()) {
    // CSD_<song>_<section>_notes.lab, e.g. CSD_ER_alto_notes.lab
    const m = lab.match(/^CSD_([A-Z]+)_([a-z]+)_notes\.lab$/);
    if (!m) {
      console.warn(`  ! unrecognised lab name: ${lab}`);
      continue;
    }
    const [, song, section] = m;
    const notes = parseLab(join(dir, lab));
    if (!notes.length) continue;
    const windows = pickWindows(notes);

    const stems = readdirSync(dir)
      .filter((f) => new RegExp(`^CSD_${song}_${section}_\\d\\.wav$`).test(f))
      .sort();
    for (const stem of stems) {
      const singer = stem.match(/_(\d)\.wav$/)?.[1];
      if (!singer) continue;
      for (let w = 0; w < windows.length; w += 1) {
        const truth = windowNotes(notes, windows[w]);
        if (truth.length < MIN_NOTES_PER_WINDOW) continue;
        // Singer-first naming so lib/split.ts's head-token grouping keeps one
        // singer's clips on one side of the dev/test split.
        const clip = `${section}${singer}_${song}_w${w}`;
        writeWindowWav(join(dir, stem), windows[w], join(OUT, `${clip}__real.wav`));
        const gt: GroundTruth = { bpm: NOMINAL_BPM, notes: truth };
        writeFileSync(join(OUT, `${clip}.truth.json`), JSON.stringify(gt, null, 2));
        clips += 1;
        totalNotes += truth.length;
      }
    }
  }

  const manifest = {
    id: 'csd',
    label: 'CSD choral stems (real singing, per-section truth, mic bleed)',
    kind: 'voice',
    instrumentId: 'voice-lead',
    source: 'https://zenodo.org/records/2649950',
    license: 'CC-BY-4.0',
    bpmAssumed: NOMINAL_BPM,
    // Caveats the numbers must carry: truth is per SECTION (individual timing
    // deviation invisible) and stems contain neighbour bleed by construction.
    noteTruthPerSection: true,
    micBleed: true,
    windowSec: WINDOW_SEC,
    clips,
    totalNotes,
  };
  writeFileSync(join(OUT, 'dataset.json'), JSON.stringify(manifest, null, 2));
  console.log(`\nConverted ${clips} CSD excerpts (${totalNotes} notes) into ${OUT}`);
}

main();
