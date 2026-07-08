/**
 * Fetch the vocadito dataset (real solo singing) and convert it into the eval
 * harness's *real* corpus layout, so run-eval can score the pipeline against
 * actual human voices instead of the synthetic voice proxy.
 *
 * Output: scripts/fixtures/eval-real/vocadito/<clip>.truth.json   ({bpm, notes})
 *         scripts/fixtures/eval-real/vocadito/<clip>__real.wav
 *         scripts/fixtures/eval-real/vocadito/dataset.json         (manifest)
 *
 * Source : https://zenodo.org/records/5578807  (vocadito, ISMIR 2021)
 * License: CC-BY-4.0 (attribution; commercial use OK).
 *
 * The 58 MB zip and its extracted contents are cached (gitignored) under
 * scripts/eval/.cache and re-converted on each run; only this script is tracked,
 * exactly like generate.ts is the tracked source of the synthetic corpus.
 *
 * Idempotent. Run: pnpm --filter api exec tsx scripts/eval/fetch-vocadito.ts
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
import { join,resolve } from 'path';

import { hzToMidi } from './lib/groundTruth';
import type { GroundTruth, TruthNote } from './types';

const ZIP_URL = 'https://zenodo.org/records/5578807/files/vocadito.zip?download=1';

const CACHE = resolve(__dirname, '.cache');
const ZIP = join(CACHE, 'vocadito.zip');
const EXTRACT = join(CACHE, 'vocadito');
const OUT = resolve(__dirname, '../fixtures/eval-real/vocadito');

// vocadito clips are free, often-rubato singing with no annotated tempo. bpm is
// only handed to the converter's quantizer; the metrics compare onsets in
// seconds, so this value does not affect scoring — it just mirrors the nominal
// tempo the live pipeline would assume absent a user-set one.
const NOMINAL_BPM = 120;

// Annotator 1 by default; the dataset also ships A2 (the paper reports low
// inter-annotator agreement, so treat note boundaries as approximate).
const ANNOTATOR = process.env.VOCADITO_ANNOTATOR ?? 'A1';

function download(): void {
  if (existsSync(ZIP)) {
    console.log(`  zip already cached: ${ZIP}`);
    return;
  }
  mkdirSync(CACHE, { recursive: true });
  console.log('  downloading vocadito.zip (~58 MB) …');
  execFileSync('curl', ['-sL', '--fail', '--max-time', '600', '-o', ZIP, ZIP_URL], {
    stdio: ['ignore', 'ignore', 'inherit'],
  });
}

function extract(): void {
  if (existsSync(join(EXTRACT, 'Audio'))) {
    console.log(`  already extracted: ${EXTRACT}`);
    return;
  }
  mkdirSync(EXTRACT, { recursive: true });
  // -o overwrite, -q quiet, -x drops the macOS resource-fork sidecar files.
  execFileSync('unzip', ['-oq', ZIP, '-d', EXTRACT, '-x', '__MACOSX/*'], {
    stdio: ['ignore', 'ignore', 'inherit'],
  });
}

/**
 * Parse a vocadito note CSV. Columns (no header): start(s), pitch(Hz), dur(s).
 * Pitch is rounded to the nearest semitone since the truth format is integer
 * MIDI; silent/zero-pitch rows (none expected in a notes file) are dropped.
 */
function parseNotes(csv: string): TruthNote[] {
  const notes: TruthNote[] = [];
  for (const line of csv.split('\n')) {
    const row = line.trim();
    if (!row) continue;
    const [startSec, pitchHz, durSec] = row.split(',').map(Number);
    if (!Number.isFinite(pitchHz) || pitchHz <= 0) continue;
    notes.push({
      onsetSec: startSec,
      durSec,
      midi: Math.round(hzToMidi(pitchHz)),
    });
  }
  notes.sort((a, b) => a.onsetSec - b.onsetSec);
  return notes;
}

function main(): void {
  download();
  extract();

  const notesDir = join(EXTRACT, 'Annotations', 'Notes');
  const audioDir = join(EXTRACT, 'Audio');

  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });

  const suffix = `_notes${ANNOTATOR}.csv`;
  const noteFiles = readdirSync(notesDir).filter((f) => f.endsWith(suffix));

  let clips = 0;
  let totalNotes = 0;
  for (const noteFile of noteFiles) {
    const clip = noteFile.replace(suffix, ''); // e.g. vocadito_1
    const wav = join(audioDir, `${clip}.wav`);
    if (!existsSync(wav)) {
      console.warn(`  ! ${clip}: audio missing, skipping`);
      continue;
    }

    const notes = parseNotes(readFileSync(join(notesDir, noteFile), 'utf8'));
    if (!notes.length) {
      console.warn(`  ! ${clip}: no notes, skipping`);
      continue;
    }

    const truth: GroundTruth = { bpm: NOMINAL_BPM, notes };
    writeFileSync(join(OUT, `${clip}.truth.json`), JSON.stringify(truth, null, 2));
    copyFileSync(wav, join(OUT, `${clip}__real.wav`));
    clips += 1;
    totalNotes += notes.length;
  }

  // Manifest read by run-eval (EVAL_REAL) for the dataset's display label and
  // adaptive instrument hint — 'voice-lead' mirrors a user picking "voice".
  const manifest = {
    id: 'vocadito',
    label: 'vocadito (real solo singing)',
    kind: 'voice',
    instrumentId: 'voice-lead',
    source: 'https://zenodo.org/records/5578807',
    license: 'CC-BY-4.0',
    annotator: ANNOTATOR,
    bpmAssumed: NOMINAL_BPM,
    clips,
    totalNotes,
  };
  writeFileSync(join(OUT, 'dataset.json'), JSON.stringify(manifest, null, 2));

  console.log(
    `\nConverted ${clips} vocadito clips (${totalNotes} notes, annotator ${ANNOTATOR}) into ${OUT}`,
  );
  console.log('Run: EVAL_REAL=1 EVAL_ADAPTIVE=1 pnpm --filter api exec tsx scripts/eval/run-eval.ts');
}

main();
