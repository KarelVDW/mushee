/**
 * Fetch AVP (Amateur Vocal Percussion) into the eval harness's real corpus
 * layout, as a PITCHLESS / onset-only dataset.
 *
 * Output: scripts/fixtures/eval-real/avp/<clip>.truth.json
 *         scripts/fixtures/eval-real/avp/<clip>__real.wav
 *         scripts/fixtures/eval-real/avp/dataset.json  (manifest, pitchless: true)
 *
 * Source : https://zenodo.org/records/5036529 — "AVP_Dataset.zip" (~220 MB)
 * License: CC-BY-4.0 (Zenodo record licence field, verified 2026-08-12).
 *
 * ## Why this dataset, and why pitchless
 *
 * AVP is real amateur vocal-percussion audio (beatboxing: kick/snare/closed-
 * and open-hihat imitations) with human-labelled onset timestamps — no pitch
 * tracker anywhere in the annotation chain, so its onsets are genuine,
 * independent ground truth. It is NOT pitched singing (fails gate 1 in
 * research-voice-datasets.md for note-transcription purposes), but the
 * register flags it as "a clean way to test OnsetDetector in isolation" —
 * our weakest component per the onset-taxonomy findings — precisely because
 * it separates onset detection from pitch estimation.
 *
 * The source CSVs carry no duration and no pitch at all (columns are
 * onset_seconds, class_label, onset_phoneme, coda_phoneme — e.g.
 * "0.085623582582766,kd,p,ə"). TruthNote still requires {durSec, midi}, so:
 *   - durSec is DERIVED as a clamped gap-to-next-onset (never a real value;
 *     onset-only scoring ignores it).
 *   - midi is a CONSTANT placeholder (60) — there is no pitch to report.
 * The dataset.json manifest sets `pitchless: true`, which (see
 * lib/realCorpus.ts / run-eval.ts) excludes it from the pooled note-F1
 * aggregate and reports it via `onsetF1` (MIREX COn) instead — the only
 * number that means something for this corpus.
 *
 * Idempotent. Run: pnpm --filter @mushee/api exec tsx scripts/eval/fetch-avp.ts
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
import { basename, join, resolve } from 'path';

import type { GroundTruth, TruthNote } from './types';

const AUDIO_URL = 'https://zenodo.org/api/records/5036529/files/AVP_Dataset.zip/content';

const CACHE = resolve(__dirname, '.cache', 'avp');
const ZIP = join(CACHE, 'AVP_Dataset.zip');
const EXTRACT = join(CACHE, 'extracted');
const OUT = resolve(__dirname, '../fixtures/eval-real/avp');

const NOMINAL_BPM = 120;
// Onset-only scoring ignores duration; this just keeps notes non-degenerate.
const MIN_DUR = 0.06;
const MAX_DUR = 0.3;
const PLACEHOLDER_MIDI = 60;

function download(url: string, dest: string, label: string): void {
  if (existsSync(dest)) {
    console.log(`  ${label} already cached: ${dest}`);
    return;
  }
  mkdirSync(CACHE, { recursive: true });
  console.log(`  downloading ${label} …`);
  execFileSync('curl', ['-sL', '--fail', '--max-time', '1800', '-o', dest, url], {
    stdio: ['ignore', 'ignore', 'inherit'],
  });
}

function extract(): void {
  if (existsSync(EXTRACT) && readdirSync(EXTRACT).length) {
    console.log(`  already extracted: ${EXTRACT}`);
    return;
  }
  mkdirSync(EXTRACT, { recursive: true });
  execFileSync('unzip', ['-oq', ZIP, '-d', EXTRACT, '-x', '__MACOSX/*'], {
    stdio: ['ignore', 'ignore', 'inherit'],
  });
}

function listFiles(root: string, suffix: string): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, entry.name);
      if (entry.isDirectory()) walk(p);
      else if (entry.name.toLowerCase().endsWith(suffix)) out.push(p);
    }
  };
  walk(root);
  return out;
}

/** Onset-only CSV, no header: onset_seconds, class_label, onset_phoneme, coda_phoneme. */
function parseOnsets(csv: string): { onsetSec: number; klass: string }[] {
  const rows: { onsetSec: number; klass: string }[] = [];
  for (const line of csv.split('\n')) {
    const cols = line.trim().split(',');
    if (cols.length < 2) continue;
    const onsetSec = Number(cols[0]);
    if (!Number.isFinite(onsetSec)) continue;
    // Exactly one row in the corpus (P23_Improvisation_Fixed.csv, line 1) has a
    // valid onset with a blank class label. The onset is real and is kept — the
    // class is not used for scoring at all, since this dataset is `pitchless`
    // and only onset times are read; it is only tallied in the manifest.
    rows.push({ onsetSec, klass: cols[1].trim() || 'unlabelled' });
  }
  rows.sort((a, b) => a.onsetSec - b.onsetSec);
  return rows;
}

function toTruthNotes(rows: { onsetSec: number; klass: string }[]): TruthNote[] {
  return rows.map((r, i) => {
    const gap = i + 1 < rows.length ? rows[i + 1].onsetSec - r.onsetSec : MAX_DUR;
    return {
      onsetSec: r.onsetSec,
      durSec: Math.min(MAX_DUR, Math.max(MIN_DUR, gap)),
      midi: PLACEHOLDER_MIDI,
    };
  });
}

function main(): void {
  download(AUDIO_URL, ZIP, 'AVP_Dataset.zip (~220 MB)');
  extract();

  const csvFiles = listFiles(EXTRACT, '.csv');
  const wavByBase = new Map<string, string>();
  for (const w of listFiles(EXTRACT, '.wav')) wavByBase.set(basename(w, '.wav'), w);

  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });

  let clips = 0;
  let totalOnsets = 0;
  const classCounts = new Map<string, number>();
  let skippedNoAudio = 0;
  let skippedNoOnsets = 0;

  for (const csvPath of csvFiles) {
    const base = basename(csvPath, '.csv');
    const wav = wavByBase.get(base);
    if (!wav) {
      skippedNoAudio += 1;
      continue;
    }
    const rows = parseOnsets(readFileSync(csvPath, 'utf8'));
    if (!rows.length) {
      skippedNoOnsets += 1;
      continue;
    }
    for (const r of rows) classCounts.set(r.klass, (classCounts.get(r.klass) ?? 0) + 1);

    const truth: GroundTruth = { bpm: NOMINAL_BPM, notes: toTruthNotes(rows) };
    const clip = `avp_${base}`;
    writeFileSync(join(OUT, `${clip}.truth.json`), JSON.stringify(truth, null, 2));
    copyFileSync(wav, join(OUT, `${clip}__real.wav`));
    clips += 1;
    totalOnsets += rows.length;
  }

  if (skippedNoAudio) console.warn(`  ! ${skippedNoAudio} CSVs had no matching audio, skipped`);
  if (skippedNoOnsets) console.warn(`  ! ${skippedNoOnsets} CSVs had no parsable onsets, skipped`);

  const manifest = {
    id: 'avp',
    label: 'AVP (real amateur vocal percussion, onset-only)',
    kind: 'voice',
    source: 'https://zenodo.org/records/5036529',
    license: 'CC-BY-4.0',
    pitchless: true,
    notes:
      'Human-labelled onset timestamps on real amateur beatboxing (kd=kick, ' +
      'sd=snare, hhc=closed hihat, hho=open hihat). No pitch anywhere in the ' +
      'chain, so onsets are genuine independent ground truth for the ' +
      'OnsetDetector in isolation — see research-voice-datasets.md. midi is a ' +
      `constant placeholder (${PLACEHOLDER_MIDI}); durSec is a derived, ` +
      'clamped gap-to-next-onset. Score via onsetF1 (MIREX COn), not note-F1.',
    classCounts: Object.fromEntries(classCounts),
    clips,
    totalOnsets,
  };
  writeFileSync(join(OUT, 'dataset.json'), JSON.stringify(manifest, null, 2));
  console.log(`\nConverted ${clips} AVP clips (${totalOnsets} onsets) into ${OUT}`);
  console.log('Run: EVAL_REAL=1 EVAL_ADAPTIVE=1 pnpm --filter api exec tsx scripts/eval/run-eval.ts');
}

main();
