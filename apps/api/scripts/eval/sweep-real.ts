/**
 * Sweep post-processing params (segmentation + NoteExtractor + tempo) on the
 * real corpus, batch path. CREPE inference is independent of these knobs, so a
 * single CrepeSession is reused per clip — the model runs once and only the
 * cheap Viterbi+segment+extract re-runs per config. Reports F1@0.1/0.2, the
 * timing-agnostic seqF1 ceiling, and seq precision/recall + est/ref counts so
 * recall vs. spurious-note tradeoffs are visible.
 *
 * Run: pnpm --filter api exec tsx scripts/eval/sweep-real.ts [dataset]
 */

import { readFileSync } from 'fs';
import { join, resolve } from 'path';

import { AudioDecoder } from '../../src/recordings/AudioDecoder';
import { NoteExtractor, type NoteExtractorOptions } from '../../src/recordings/NoteExtractor';
import { OnsetDetector, type OnsetDetectorOptions } from '../../src/recordings/OnsetDetector';
import { ProfileResolver } from '../../src/recordings/profiles/ProfileResolver';
import { ProviderRegistry } from '../../src/recordings/providers/ProviderRegistry';
import type { PitchTranscribeOptions } from '../../src/recordings/providers/PitchProvider';
import { scoreNotes, type EstNote } from './lib/metrics';
import { discoverRealDatasets, listRealClips } from './lib/realCorpus';
import type { GroundTruth, TruthNote } from './types';

const DETECT_SR = 16000;
const REAL_ROOT = resolve(__dirname, '../fixtures/eval-real');
const MODELS = {
  basicPitch: resolve(process.cwd(), 'model'),
  crepeTiny: resolve(process.cwd(), 'model-crepe-tiny'),
};

interface SegOpts {
  minFramesPerNote?: number;
  pitchBinToleranceCents?: number;
  confidenceThreshold?: number;
  segmentMode?: 'median' | 'semitone';
  smoothFrames?: number;
  tuningCorrect?: boolean;
}

const SEMI = { segmentMode: 'semitone' as const, smoothFrames: 4 };
interface Config {
  name: string;
  seg: SegOpts;
  ext: NoteExtractorOptions;
  bpm: '120' | 'gt';
  onset?: OnsetDetectorOptions;
}

// Focused on the winning region: semitone-merge segmentation + temporal
// smoothing (hysteresis) + voicing gate, matched tempo, notation-aligned grid.
const CONFIGS: Config[] = [
  { name: 'onset default', seg: { ...SEMI }, ext: { maxGridDivisor: 4 }, bpm: 'gt' },
  { name: 'dip.6', seg: { ...SEMI }, ext: { maxGridDivisor: 4 }, bpm: 'gt', onset: { dipRatio: 0.6 } },
  { name: 'dip.7 rise1.5', seg: { ...SEMI }, ext: { maxGridDivisor: 4 }, bpm: 'gt', onset: { dipRatio: 0.7, riseRatio: 1.5 } },
  { name: 'dip.7 rise1.4 ioi.07', seg: { ...SEMI }, ext: { maxGridDivisor: 4 }, bpm: 'gt', onset: { dipRatio: 0.7, riseRatio: 1.4, minIoiSec: 0.07 } },
  { name: 'dip.8 rise1.3 ioi.06', seg: { ...SEMI }, ext: { maxGridDivisor: 4 }, bpm: 'gt', onset: { dipRatio: 0.8, riseRatio: 1.3, minIoiSec: 0.06 } },
];

function mean(xs: number[]): number {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
}
function median(xs: number[]): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
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
function seqStats(ref: TruthNote[], est: EstNote[]): { f1: number; p: number; r: number } {
  const m = lcsLen(ref.map((n) => n.midi), est.map((n) => n.midi));
  const p = est.length ? m / est.length : 0;
  const r = ref.length ? m / ref.length : 0;
  return { f1: p + r > 0 ? (2 * p * r) / (p + r) : 0, p, r };
}
function bpmFromOnsets(onsets: number[]): number {
  const iois: number[] = [];
  for (let i = 1; i < onsets.length; i += 1) {
    const d = onsets[i] - onsets[i - 1];
    if (d > 0.05) iois.push(d);
  }
  const med = median(iois);
  return med ? Math.max(50, Math.min(200, 60 / med)) : 120;
}

async function main(): Promise<void> {
  const registry = new ProviderRegistry({ basicPitch: MODELS.basicPitch, crepeTiny: MODELS.crepeTiny });
  await registry.initAll();
  const resolver = new ProfileResolver();
  const decoder = new AudioDecoder();

  const filter = (process.argv[2] ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  const datasets = discoverRealDatasets(REAL_ROOT).filter((d) => !filter.length || filter.includes(d.id));
  const TOLS = [0.1, 0.2];

  for (const ds of datasets) {
    const acc: Record<string, { f1: Record<number, number[]>; seq: number[]; seqP: number[]; seqR: number[]; estN: number[]; refN: number[] }> = {};
    for (const c of CONFIGS) {
      acc[c.name] = { f1: { 0.1: [], 0.2: [] }, seq: [], seqP: [], seqR: [], estN: [], refN: [] };
    }

    for (const clip of listRealClips(ds.dir)) {
      let truth: GroundTruth;
      let wav: Buffer;
      try {
        truth = JSON.parse(readFileSync(join(ds.dir, `${clip}.truth.json`), 'utf8'));
        wav = readFileSync(join(ds.dir, `${clip}__real.wav`));
      } catch {
        continue;
      }
      const det = await decoder.decode(wav, DETECT_SR, { loudnorm: false, highpassHz: 30 });
      const profile = resolver.resolve(det.samples, DETECT_SR, { instrumentId: ds.instrumentId });
      const provider = registry.get(profile.providerName);
      const decoded = await decoder.decode(wav, provider.sampleRate, {
        loudnorm: provider.normalizeLoudness,
        highpassHz: profile.highpassHz,
      });
      const gtBpm = bpmFromOnsets(truth.notes.map((n) => n.onsetSec));
      const session = provider.createSession(); // reused → inference cached across configs

      const baseOpts: PitchTranscribeOptions = {
        minFreqHz: profile.minFreqHz,
        maxFreqHz: profile.maxFreqHz,
        confidenceThreshold: profile.confidenceThreshold,
      };

      for (const c of CONFIGS) {
        const raw = await provider.transcribe(decoded.samples, { ...baseOpts, ...c.seg }, undefined, session);
        const bpm = c.bpm === 'gt' ? gtBpm : 120;
        const onsetTimesSec = new OnsetDetector(c.onset).detect(decoded.samples, provider.sampleRate);
        const extracted = new NoteExtractor(c.ext).extract(raw, { bpm, onsetTimesSec });
        const est: EstNote[] = extracted.deduced.map((n) => ({
          onsetSec: n.startTimeSeconds, durSec: n.durationSeconds, midi: n.pitchMidi,
        }));
        const a = acc[c.name];
        for (const t of TOLS) a.f1[t].push(scoreNotes(truth.notes, est, { onsetTolSec: t, timingTolSec: 0.3 }).f1);
        const s = seqStats(truth.notes, est);
        a.seq.push(s.f1); a.seqP.push(s.p); a.seqR.push(s.r);
        a.estN.push(est.length); a.refN.push(truth.notes.length);
      }
    }

    console.log(`\n=== ${ds.id} (batch path, ${listRealClips(ds.dir).length} clips) ===`);
    console.log('config'.padEnd(20) + 'F1@.1'.padEnd(7) + 'F1@.2'.padEnd(7) + 'seqF1'.padEnd(7) + 'seqP'.padEnd(7) + 'seqR'.padEnd(7) + 'est/ref');
    for (const c of CONFIGS) {
      const a = acc[c.name];
      console.log(
        c.name.padEnd(20) +
          mean(a.f1[0.1]).toFixed(3).padEnd(7) +
          mean(a.f1[0.2]).toFixed(3).padEnd(7) +
          mean(a.seq).toFixed(3).padEnd(7) +
          mean(a.seqP).toFixed(2).padEnd(7) +
          mean(a.seqR).toFixed(2).padEnd(7) +
          `${mean(a.estN).toFixed(0)}/${mean(a.refN).toFixed(0)}`,
      );
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
