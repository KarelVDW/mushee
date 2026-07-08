/**
 * Decompose WHERE note-F1 is lost on the real corpus, so optimization targets
 * the real bottleneck instead of guessing. For each clip it scores two outputs:
 *   - deduced : NoteExtractor's quantized notes (what run-eval scores, "batch")
 *   - pipeline: the full MusicXML round-trip (what the user actually gets)
 * each at a sweep of onset tolerances, plus `seqF1` — a timing-AGNOSTIC ceiling
 * (longest common subsequence of the pitch sequences). Reading the row:
 *   - seqF1 high but F1@0.1 low  -> pitches are right, TIMING/quantization is the
 *     loss (recoverable by a finer grid / tempo fit)
 *   - seqF1 itself low           -> genuine pitch/recall error (need better
 *     detection); no quantization fix can exceed it
 *
 * Run: EVAL_REAL=1 EVAL_ADAPTIVE=1 pnpm --filter api exec tsx scripts/eval/diagnose-real.ts
 */

import { readFileSync } from 'fs';
import { join, resolve } from 'path';

import { AudioConverter } from '../../src/recordings/pipeline/audio-converter';
import { AudioDecoder } from '../../src/recordings/pipeline/audio-decoder';
import { ProfileResolver } from '../../src/recordings/pipeline/profiles/profile-resolver';
import { ProviderRegistry } from '../../src/recordings/pipeline/providers/provider-registry';
import { type EstNote,scoreNotes } from './lib/metrics';
import { runThroughPipeline } from './lib/pipelineRun';
import { discoverRealDatasets, listRealClips } from './lib/realCorpus';
import type { GroundTruth, TruthNote } from './types';

const DETECT_SR = 16000;
const REAL_ROOT = resolve(__dirname, '../fixtures/eval-real');
const MODELS = {
  basicPitch: resolve(process.cwd(), 'model'),
  crepeTiny: resolve(process.cwd(), 'model-crepe-tiny'),
};
const TOLS = [0.05, 0.1, 0.2, 0.3];

function mean(xs: number[]): number {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
}

/** Longest common subsequence length over two integer sequences. */
function lcsLen(a: number[], b: number[]): number {
  const dp: number[] = new Array<number>(b.length + 1).fill(0);
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

/** Timing-free LCS of pitch sequences (order kept, time ignored). */
function seqStats(ref: TruthNote[], est: EstNote[]): { f1: number; p: number; r: number } {
  const m = lcsLen(ref.map((n) => n.midi), est.map((n) => n.midi));
  const p = est.length ? m / est.length : 0;
  const r = ref.length ? m / ref.length : 0;
  return { f1: p + r > 0 ? (2 * p * r) / (p + r) : 0, p, r };
}

interface RowAcc {
  f1: Record<number, number[]>;
  chroma: number[];
  seq: number[];
  seqP: number[];
  seqR: number[];
  refN: number[];
  estN: number[];
}

function emptyRow(): RowAcc {
  return {
    f1: Object.fromEntries(TOLS.map((t) => [t, []])),
    chroma: [], seq: [], seqP: [], seqR: [], refN: [], estN: [],
  };
}

function record(acc: RowAcc, ref: TruthNote[], est: EstNote[]): void {
  for (const tol of TOLS) {
    acc.f1[tol].push(scoreNotes(ref, est, { onsetTolSec: tol, timingTolSec: 0.3 }).f1);
  }
  acc.chroma.push(scoreNotes(ref, est, { onsetTolSec: 0.1, timingTolSec: 0.3 }).chromaF1);
  const s = seqStats(ref, est);
  acc.seq.push(s.f1);
  acc.seqP.push(s.p);
  acc.seqR.push(s.r);
  acc.refN.push(ref.length);
  acc.estN.push(est.length);
}

function printRow(label: string, acc: RowAcc): void {
  console.log(
    label.padEnd(18) +
      TOLS.map((t) => mean(acc.f1[t]).toFixed(2).padEnd(7)).join('') +
      mean(acc.seq).toFixed(2).padEnd(7) +
      mean(acc.seqP).toFixed(2).padEnd(7) +
      mean(acc.seqR).toFixed(2).padEnd(7) +
      `${mean(acc.estN).toFixed(0)}/${mean(acc.refN).toFixed(0)}`,
  );
}

function dumpNotes(label: string, notes: { onsetSec: number; durSec: number; midi: number }[]): void {
  console.log(`  ${label} (${notes.length}):`);
  console.log(
    '    ' +
      notes
        .map((n) => `${n.onsetSec.toFixed(2)}/${n.durSec.toFixed(2)}/${n.midi}`)
        .join('  '),
  );
}

async function main(): Promise<void> {
  const registry = new ProviderRegistry({
    basicPitch: MODELS.basicPitch,
    crepeTiny: MODELS.crepeTiny,
  });
  await registry.initAll();
  const resolver = new ProfileResolver();
  const decoder = new AudioDecoder();

  const filter = (process.argv[2] ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  const datasets = discoverRealDatasets(REAL_ROOT).filter(
    (d) => !filter.length || filter.includes(d.id),
  );

  // Batch path: the production adaptive resolve + convert, returning the
  // NoteExtractor's deduced notes (no MusicXML round-trip).
  async function batchTranscribe(buf: Buffer, bpm: number, instrumentId?: string): Promise<EstNote[]> {
    const det = await decoder.decode(buf, DETECT_SR, { loudnorm: false, highpassHz: 30 });
    const profile = resolver.resolve(det.samples, DETECT_SR, { instrumentId });
    const provider = registry.get(profile.providerName);
    const decoded = await decoder.decode(buf, provider.sampleRate, {
      loudnorm: provider.normalizeLoudness,
      highpassHz: profile.highpassHz,
    });
    const extracted = await new AudioConverter(provider).convert(decoded.samples, { bpm }, undefined, {
      minFreqHz: profile.minFreqHz,
      maxFreqHz: profile.maxFreqHz,
      confidenceThreshold: profile.confidenceThreshold,
      onsetThreshold: profile.onsetThreshold,
      frameThreshold: profile.frameThreshold,
    });
    return extracted.deduced.map((n) => ({
      onsetSec: n.startTimeSeconds,
      durSec: n.durationSeconds,
      midi: n.pitchMidi,
    }));
  }

  const inspect = process.env.INSPECT;

  for (const ds of datasets) {
    const deduced = emptyRow();
    const pipeline = emptyRow();
    for (const clip of listRealClips(ds.dir)) {
      let truth: GroundTruth;
      let wav: Buffer;
      try {
        truth = JSON.parse(readFileSync(join(ds.dir, `${clip}.truth.json`), 'utf8')) as GroundTruth;
        wav = readFileSync(join(ds.dir, `${clip}__real.wav`));
      } catch {
        continue;
      }
      const batch = await batchTranscribe(wav, truth.bpm, ds.instrumentId);
      const pipe = await runThroughPipeline(registry, resolver, wav, truth.bpm, 4, ds.instrumentId ?? '');

      if (inspect && clip === inspect) {
        console.log(`\n--- inspect ${clip} (bpm=${truth.bpm}) ---`);
        dumpNotes('truth   ', truth.notes);
        dumpNotes('deduced ', batch);
        dumpNotes('pipeline', pipe);
      }
      record(deduced, truth.notes, batch);
      record(pipeline, truth.notes, pipe);
    }
    console.log(`\n=== ${ds.id} (${ds.label}) ===`);
    console.log(
      'variant'.padEnd(18) +
        TOLS.map((t) => `F1@${t}`.padEnd(7)).join('') +
        'seqF1'.padEnd(7) + 'seqP'.padEnd(7) + 'seqR'.padEnd(7) + 'est/ref',
    );
    printRow('deduced (batch)', deduced);
    printRow('pipeline (MXML)', pipeline);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
