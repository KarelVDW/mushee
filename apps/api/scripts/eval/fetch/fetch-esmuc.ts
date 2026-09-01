/**
 * Fetch the ESMUC Choir Dataset and convert its per-singer annotated tracks into
 * the eval harness's real corpus layout.
 *
 * Output: scripts/fixtures/eval-real/benchmark/esmuc-choir/<clip>.truth.json
 *         scripts/fixtures/eval-real/benchmark/esmuc-choir/<clip>__real.wav
 *         scripts/fixtures/eval-real/benchmark/esmuc-choir/dataset.json
 *
 * Source : https://zenodo.org/records/5848990  (2.34 GB zip)
 * License: CC-BY-4.0 (the record's own licence field; first-party MTG deposit).
 *          Adopted per the acquisition policy in research/research-voice-datasets.md.
 *
 * ## What this corpus is
 *
 * 12 conservatoire vocal-performance students (SATB), recorded simultaneously
 * with one close-up mic per singer plus two stereo room mics, singing Schütz,
 * Haydn and Heiller. Every close-mic track carries **manually corrected** F0 and
 * note annotations (`.lab`: onset s · f0 Hz · duration s) — measured pitch with
 * real intonation variation, annotated PER SINGER PER TAKE, which makes it the
 * strongest-provenance choral truth in the harness (CSD's notes are per section).
 *
 * ## Caveats carried into every result
 *
 * - **Bleed**: singers recorded simultaneously; close mics pick up neighbours.
 *   Kept as its own dataset so it is never mixed into a clean-condition read.
 * - **Trained singers** — conservatoire students, not amateurs on a phone;
 *   complements the amateur corpora (HUST, vocadito) rather than replacing them.
 * - Warm-up tracks (WU) have no note annotation and are skipped; the stereo room
 *   mics (ORTF/AB) have no annotation of their own and are skipped too.
 *
 * Idempotent. Run: pnpm --filter @mushee/api exec tsx scripts/eval/fetch/fetch-esmuc.ts
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

import { hzToMidi } from '../lib/groundTruth';
import type { GroundTruth, TruthNote } from '../types';

const ZIP_URL =
  'https://zenodo.org/api/records/5848990/files/EsmucChoirDataset_v1.0.0.zip/content';

const CACHE = resolve(__dirname, '../.cache');
const ZIP = join(CACHE, 'esmuc.zip');
const EXTRACT = join(CACHE, 'esmuc');
const OUT = resolve(__dirname, '../../fixtures/eval-real/benchmark/esmuc-choir');

const NOMINAL_BPM = 120; // metrics compare seconds; bpm only feeds the quantizer
const MIN_NOTES_PER_CLIP = 5;

function download(): void {
  if (existsSync(ZIP)) {
    console.log(`  zip already cached: ${ZIP}`);
    return;
  }
  mkdirSync(CACHE, { recursive: true });
  console.log('  downloading EsmucChoirDataset_v1.0.0.zip (~2.34 GB) …');
  execFileSync('curl', ['-sL', '--fail', '--max-time', '7200', '-o', ZIP, ZIP_URL], {
    stdio: ['ignore', 'ignore', 'inherit'],
  });
}

function extract(): void {
  if (existsSync(EXTRACT) && readdirSync(EXTRACT).some((f) => f.endsWith('.lab'))) {
    console.log(`  already extracted: ${EXTRACT}`);
    return;
  }
  mkdirSync(EXTRACT, { recursive: true });
  // The zip is flat (no top-level directory). Only wavs and labs are needed —
  // the 300 .f0 files are frame-level contours the harness does not read.
  execFileSync('unzip', ['-oq', ZIP, '*.wav', '*.lab', '-d', EXTRACT], {
    stdio: ['ignore', 'ignore', 'inherit'],
  });
}

/** Parse a `.lab`: whitespace-separated `onset_s  f0_Hz  duration_s`. */
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

function main(): void {
  download();
  extract();

  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });

  // <song>_<setting>_<takeOrShort>_<Voice><n>.lab, e.g. SC1_FT_take3_A1.lab.
  // Every lab-bearing track is a singer close mic (room mics have no lab).
  const labs = readdirSync(EXTRACT).filter((f) => f.endsWith('.lab')).sort();
  let clips = 0;
  let totalNotes = 0;
  const singers = new Set<string>();
  for (const lab of labs) {
    const m = lab.match(/^(.+)_([SATB]\d)\.lab$/);
    if (!m) {
      console.warn(`  ! unrecognised lab name: ${lab}`);
      continue;
    }
    const [, takeId, singer] = m;
    const wav = join(EXTRACT, `${takeId}_${singer}.wav`);
    if (!existsSync(wav)) {
      console.warn(`  ! ${takeId}_${singer}: audio missing, skipping`);
      continue;
    }
    const notes = parseLab(join(EXTRACT, lab));
    if (notes.length < MIN_NOTES_PER_CLIP) {
      console.warn(`  ! ${takeId}_${singer}: only ${notes.length} notes, skipping`);
      continue;
    }
    // Singer-first naming so lib/split.ts's head-token grouping keeps one
    // singer's clips on one side of the dev/test split.
    const clip = `${singer}_${takeId}`;
    const truth: GroundTruth = { bpm: NOMINAL_BPM, notes };
    writeFileSync(join(OUT, `${clip}.truth.json`), JSON.stringify(truth, null, 2));
    copyFileSync(wav, join(OUT, `${clip}__real.wav`));
    singers.add(singer);
    clips += 1;
    totalNotes += notes.length;
  }

  const manifest = {
    id: 'esmuc-choir',
    label: 'ESMUC choir stems (real singing, per-singer truth, mic bleed)',
    kind: 'voice',
    instrumentId: 'voice-lead',
    source: 'https://zenodo.org/records/5848990',
    license: 'CC-BY-4.0',
    bpmAssumed: NOMINAL_BPM,
    micBleed: true,
    singers: [...singers].sort(),
    clips,
    totalNotes,
  };
  writeFileSync(join(OUT, 'dataset.json'), JSON.stringify(manifest, null, 2));
  console.log(
    `\nConverted ${clips} ESMUC tracks (${totalNotes} notes, ${singers.size} singers) into ${OUT}`,
  );
}

main();
