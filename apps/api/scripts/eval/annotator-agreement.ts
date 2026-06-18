/**
 * Inter-annotator agreement ceiling for vocadito: score annotator A1's notes
 * against A2's (and vice-versa) with the SAME metrics the pipeline is judged by.
 * This is the realistic upper bound — a pipeline can't meaningfully beat the
 * level at which two human experts agree, so it tells us whether a target like
 * F1>=0.80 is achievable honestly or would mean overfitting to one annotator.
 *
 * Reads the raw cached CSVs directly (no model run). Run:
 *   pnpm --filter api exec tsx scripts/eval/annotator-agreement.ts
 */

import { existsSync, readdirSync, readFileSync } from 'fs';
import { join, resolve } from 'path';

import { hzToMidi } from './lib/groundTruth';
import { scoreNotes, type EstNote } from './lib/metrics';
import type { TruthNote } from './types';

const NOTES_DIR = resolve(__dirname, '.cache/vocadito/Annotations/Notes');

function parseNotes(csv: string): TruthNote[] {
  const notes: TruthNote[] = [];
  for (const line of csv.split('\n')) {
    const row = line.trim();
    if (!row) continue;
    const [startSec, pitchHz, durSec] = row.split(',').map(Number);
    if (!Number.isFinite(pitchHz) || pitchHz <= 0) continue;
    notes.push({ onsetSec: startSec, durSec, midi: Math.round(hzToMidi(pitchHz)) });
  }
  return notes.sort((a, b) => a.onsetSec - b.onsetSec);
}

function lcsLen(a: number[], b: number[]): number {
  const dp = new Array(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i += 1) {
    let prev = 0;
    for (let j = 1; j <= b.length; j += 1) {
      const tmp = dp[j];
      dp[j] = a[i - 1] === b[j - 1] ? prev + 1 : Math.max(dp[j], dp[j - 1]);
      prev = tmp;
    }
  }
  return dp[b.length];
}

function seqF1(ref: TruthNote[], est: EstNote[]): number {
  const m = lcsLen(ref.map((n) => n.midi), est.map((n) => n.midi));
  const p = est.length ? m / est.length : 0;
  const r = ref.length ? m / ref.length : 0;
  return p + r > 0 ? (2 * p * r) / (p + r) : 0;
}

function mean(xs: number[]): number {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
}

function main(): void {
  if (!existsSync(NOTES_DIR)) {
    console.error(`Missing ${NOTES_DIR} — run fetch-vocadito.ts first.`);
    process.exit(1);
  }
  const clips = readdirSync(NOTES_DIR)
    .filter((f) => f.endsWith('_notesA1.csv'))
    .map((f) => f.replace('_notesA1.csv', ''));

  const f1_01: number[] = [];
  const f1_02: number[] = [];
  const seq: number[] = [];
  for (const clip of clips) {
    const a1 = parseNotes(readFileSync(join(NOTES_DIR, `${clip}_notesA1.csv`), 'utf8'));
    const a2 = parseNotes(readFileSync(join(NOTES_DIR, `${clip}_notesA2.csv`), 'utf8'));
    // Treat A1 as reference, A2 as the "estimate" — the agreement is symmetric
    // enough for a ceiling.
    const est: EstNote[] = a2.map((n) => ({ onsetSec: n.onsetSec, durSec: n.durSec, midi: n.midi }));
    f1_01.push(scoreNotes(a1, est, { onsetTolSec: 0.1, timingTolSec: 0.3 }).f1);
    f1_02.push(scoreNotes(a1, est, { onsetTolSec: 0.2, timingTolSec: 0.3 }).f1);
    seq.push(seqF1(a1, est));
  }

  console.log(`vocadito A1-vs-A2 inter-annotator agreement over ${clips.length} clips:`);
  console.log(`  note-F1 @0.1s onset tol : ${mean(f1_01).toFixed(3)}`);
  console.log(`  note-F1 @0.2s onset tol : ${mean(f1_02).toFixed(3)}`);
  console.log(`  seqF1 (timing-agnostic) : ${mean(seq).toFixed(3)}`);
}

main();
