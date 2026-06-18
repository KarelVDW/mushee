/**
 * Two questions, one run, on the real corpus:
 *   1. Does feeding a tempo MATCHED to the performance (what a cooperative user
 *      who set their metronome would give) beat the fixed bpm=120 we currently
 *      assume on free-tempo singing? Tested with bpm estimated from the audio
 *      onsets (deployable, no GT) and from the GT onsets (upper bound).
 *   2. How much F1 is lost purely to the MusicXML round-trip? (batch deduced vs
 *      full pipeline, same tempo.)
 *
 * Diagnostic only — informs which general changes are worth making.
 * Run: pnpm --filter api exec tsx scripts/eval/tempo-experiment.ts [dataset]
 */

import { readFileSync } from 'fs';
import { join, resolve } from 'path';

import { AudioConverter } from '../../src/recordings/AudioConverter';
import { AudioDecoder } from '../../src/recordings/AudioDecoder';
import { OnsetDetector } from '../../src/recordings/OnsetDetector';
import { ProfileResolver } from '../../src/recordings/profiles/ProfileResolver';
import { ProviderRegistry } from '../../src/recordings/providers/ProviderRegistry';
import { scoreNotes, type EstNote } from './lib/metrics';
import { runThroughPipeline } from './lib/pipelineRun';
import { discoverRealDatasets, listRealClips } from './lib/realCorpus';
import type { GroundTruth, TruthNote } from './types';

const DETECT_SR = 16000;
const REAL_ROOT = resolve(__dirname, '../fixtures/eval-real');
const MODELS = {
  basicPitch: resolve(process.cwd(), 'model'),
  crepeTiny: resolve(process.cwd(), 'model-crepe-tiny'),
};

function mean(xs: number[]): number {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
}

function median(xs: number[]): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** bpm from a set of onset times: median inter-onset interval ≈ one beat. */
function bpmFromOnsets(onsets: number[]): number {
  const iois: number[] = [];
  for (let i = 1; i < onsets.length; i += 1) {
    const d = onsets[i] - onsets[i - 1];
    if (d > 0.05) iois.push(d);
  }
  const med = median(iois);
  if (!med) return 120;
  return Math.max(50, Math.min(200, 60 / med));
}

async function main(): Promise<void> {
  const registry = new ProviderRegistry({
    basicPitch: MODELS.basicPitch,
    crepeTiny: MODELS.crepeTiny,
  });
  await registry.initAll();
  const resolver = new ProfileResolver();
  const decoder = new AudioDecoder();
  const onsetDetector = new OnsetDetector();

  async function batchTranscribe(wav: Buffer, bpm: number, instrumentId?: string): Promise<EstNote[]> {
    const det = await decoder.decode(wav, DETECT_SR, { loudnorm: false, highpassHz: 30 });
    const profile = resolver.resolve(det.samples, DETECT_SR, { instrumentId });
    const provider = registry.get(profile.providerName);
    const decoded = await decoder.decode(wav, provider.sampleRate, {
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
      onsetSec: n.startTimeSeconds, durSec: n.durationSeconds, midi: n.pitchMidi,
    }));
  }

  /** bpm estimated from audio onsets (deployable, no ground truth). */
  async function audioBpm(wav: Buffer): Promise<number> {
    const dec = await decoder.decode(wav, DETECT_SR, { loudnorm: false, highpassHz: 30 });
    return bpmFromOnsets(onsetDetector.detect(dec.samples, DETECT_SR));
  }

  const filter = (process.argv[2] ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  const datasets = discoverRealDatasets(REAL_ROOT).filter(
    (d) => !filter.length || filter.includes(d.id),
  );

  const TOLS = [0.1, 0.2];
  for (const ds of datasets) {
    // config -> { f1@tol[], } accumulators
    const acc: Record<string, Record<number, number[]>> = {};
    const add = (cfg: string, ref: TruthNote[], est: EstNote[]): void => {
      acc[cfg] ??= Object.fromEntries(TOLS.map((t) => [t, []]));
      for (const t of TOLS) acc[cfg][t].push(scoreNotes(ref, est, { onsetTolSec: t, timingTolSec: 0.3 }).f1);
    };

    for (const clip of listRealClips(ds.dir)) {
      let truth: GroundTruth;
      let wav: Buffer;
      try {
        truth = JSON.parse(readFileSync(join(ds.dir, `${clip}.truth.json`), 'utf8'));
        wav = readFileSync(join(ds.dir, `${clip}__real.wav`));
      } catch {
        continue;
      }
      const gtBpm = bpmFromOnsets(truth.notes.map((n) => n.onsetSec));
      const aBpm = await audioBpm(wav);

      add('batch  bpm=120', truth.notes, await batchTranscribe(wav, 120, ds.instrumentId));
      add('batch  bpm=gt', truth.notes, await batchTranscribe(wav, gtBpm, ds.instrumentId));
      add('pipe   bpm=120', truth.notes, await runThroughPipeline(registry, resolver, wav, 120, 4, ds.instrumentId ?? ''));
      add('pipe   bpm=audio', truth.notes, await runThroughPipeline(registry, resolver, wav, aBpm, 4, ds.instrumentId ?? ''));
      add('pipe   bpm=gt', truth.notes, await runThroughPipeline(registry, resolver, wav, gtBpm, 4, ds.instrumentId ?? ''));
    }

    console.log(`\n=== ${ds.id} ===`);
    console.log('config'.padEnd(18) + TOLS.map((t) => `F1@${t}`.padEnd(8)).join(''));
    for (const cfg of Object.keys(acc)) {
      console.log(cfg.padEnd(18) + TOLS.map((t) => mean(acc[cfg][t]).toFixed(3).padEnd(8)).join(''));
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
