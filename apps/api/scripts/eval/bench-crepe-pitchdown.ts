/**
 * Can CREPE cover the `very-high` band if the audio is pitched DOWN first?
 *
 * The provider-consolidation question: basic-pitch exists in the fleet for the
 * one register CREPE cannot see (above its ~1997 Hz ceiling — piccolo,
 * whistling) plus the no-pitch fallback. If CREPE-on-shifted-audio matches
 * basic-pitch there, the second inference service can be dropped.
 *
 * The shift is exact and artifact-free: decode the clip at `16 kHz × k` and
 * hand the samples to CREPE as if they were 16 kHz — i.e. play the take at
 * 1/k speed. Every frequency divides by k (harmonic structure preserved, like
 * a tape machine), every duration multiplies by k. Afterwards divide times by
 * k and add 12·log2(k) semitones. No phase vocoder, no resampling artifacts
 * beyond ffmpeg's own resampler, at the price of k× inference cost.
 *
 * Coverage per factor (band window 500–4500 Hz, CREPE usable to ~1950 Hz):
 *   k=1: 500–1950 Hz (the naive drop — anything above is invisible)
 *   k=2: 500–3900 Hz (misses only the piccolo's top ~2 semitones)
 *   k=4: 500–4500 Hz (full band; model-domain floor 125 Hz)
 *
 * Scored exactly like run-eval (COnP@±100 ms, scoreNotesBest) over the
 * very-high synthetic scenarios × all 7 conditions, with paired-bootstrap CIs
 * against the basic-pitch control. Synthetic only — there is no real corpus
 * for this register (see the README open items), which is also true of the
 * shipping basic-pitch path itself.
 *
 * Run: pnpm --filter @mushee/api exec tsx scripts/eval/bench-crepe-pitchdown.ts
 * Env: EVAL_SCENARIOS (default whistle-mid,whistle-high,piccolo-veryhigh)
 *      EVAL_CONDITIONS (default all)
 *      PITCHDOWN_FLOOR_MS (real-time note floor, default 80)
 */

import { existsSync, readdirSync, readFileSync } from 'fs';
import { join, resolve } from 'path';

import { AudioConverter } from '../../src/recordings/pipeline/audio-converter';
import { AudioDecoder } from '../../src/recordings/pipeline/audio-decoder';
import { estimateReverberance } from '../../src/recordings/pipeline/profiles/profile-resolver';
import { BasicPitchProvider } from '../../src/recordings/pipeline/providers/basic-pitch-provider';
import { CrepeProvider } from '../../src/recordings/pipeline/providers/crepe-provider';
import { LocalModelBackend } from '../../src/recordings/pipeline/providers/local-model-backend';
import type { PitchProvider } from '../../src/recordings/pipeline/providers/pitch-provider';
import { type EstNote, scoreNotesBest } from './lib/metrics';
import { formatComparison, pairedDiffCI } from './lib/stats';
import { CONDITIONS, SCENARIOS } from './scenarios';
import type { GroundTruth } from './types';

const SYNTH_ROOT = resolve(__dirname, '../fixtures/eval');
const MODELS = {
  basicPitch: resolve(process.cwd(), 'model'),
  crepeTiny: resolve(process.cwd(), 'model-crepe-tiny'),
};

/** The very-high band's shipping anchor (pipeline-profile.ts). */
const BAND = { minFreqHz: 500, maxFreqHz: 4500, highpassHz: 300 };
/** CREPE's usable ceiling in the model domain (README: accurate to 1976 Hz). */
const CREPE_CEILING_HZ = 1950;
const CREPE_SR = 16000;
const FLOOR_MS = Number(process.env.PITCHDOWN_FLOOR_MS) || 80;

interface Config {
  name: string;
  provider: 'basic-pitch' | 'crepe';
  /** Slow-down factor k: decode at 16 kHz × k, feed to CREPE as 16 kHz. */
  factor: number;
  /**
   * Apply the production reverberance ramp (`applyReverb`'s constants) to the
   * voicing gate. The shipping basic-pitch band never gets this adaptation —
   * `applyReverb` requires a `confidenceThreshold` — so a CREPE-backed
   * very-high band would gain it for free. Estimated on a plain 16 kHz decode,
   * like the resolver.
   */
  reverbRamp?: boolean;
}

const CONFIGS: Config[] = [
  { name: 'basic-pitch (ships)', provider: 'basic-pitch', factor: 1 },
  { name: 'crepe k1 (naive)', provider: 'crepe', factor: 1 },
  { name: 'crepe k2 (-1 oct)', provider: 'crepe', factor: 2 },
  { name: 'crepe k2 +rev-ramp', provider: 'crepe', factor: 2, reverbRamp: true },
  { name: 'crepe k4 (-2 oct)', provider: 'crepe', factor: 4 },
];

function listEnv(key: string, fallback: string[]): string[] {
  const v = process.env[key];
  return v ? v.split(',').map((s) => s.trim()).filter(Boolean) : fallback;
}

function mean(xs: number[]): number {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
}

async function main(): Promise<void> {
  const scenarioIds = listEnv('EVAL_SCENARIOS', [
    'whistle-mid',
    'whistle-high',
    'piccolo-veryhigh',
  ]);
  const conditionIds = listEnv(
    'EVAL_CONDITIONS',
    CONDITIONS.filter((c) => c.detuneCents === undefined).map((c) => c.id),
  );
  const scenarios = SCENARIOS.filter((s) => scenarioIds.includes(s.id));

  const backend = new LocalModelBackend(MODELS);
  const decoder = new AudioDecoder();
  const providers: Record<string, PitchProvider> = {
    'basic-pitch': new BasicPitchProvider(backend),
    crepe: new CrepeProvider(backend, 'crepe-tiny'),
  };
  await providers['basic-pitch'].init();
  await providers.crepe.init();

  // clipKey (scenario/melody/condition) → per-config f1, in a stable order for
  // the paired comparison.
  const clipKeys: string[] = [];
  const f1ByConfig = new Map<string, number[]>(CONFIGS.map((c) => [c.name, []]));
  const perScenario = new Map<string, Map<string, number[]>>();
  const perCondition = new Map<string, Map<string, number[]>>();

  for (const scenario of scenarios) {
    const dir = join(SYNTH_ROOT, scenario.id);
    if (!existsSync(dir)) continue;
    const truths = readdirSync(dir).filter((f) => f.endsWith('.truth.json'));

    for (const truthFile of truths) {
      const melody = truthFile.replace('.truth.json', '');
      const truth = JSON.parse(
        readFileSync(join(dir, truthFile), 'utf8'),
      ) as GroundTruth;

      for (const conditionId of conditionIds) {
        const wavPath = join(dir, `${melody}__${conditionId}.wav`);
        if (!existsSync(wavPath)) continue;
        const buf = readFileSync(wavPath);
        clipKeys.push(`${scenario.id}/${melody}/${conditionId}`);

        for (const cfg of CONFIGS) {
          const provider = providers[cfg.provider];
          let est: EstNote[] = [];
          try {
            if (cfg.provider === 'basic-pitch') {
              const decoded = await decoder.decode(buf, provider.sampleRate, {
                loudnorm: provider.normalizeLoudness,
                highpassHz: BAND.highpassHz,
              });
              const extracted = await new AudioConverter(provider).convert(
                decoded.samples,
                { bpm: truth.bpm },
                undefined,
                {
                  minFreqHz: BAND.minFreqHz,
                  maxFreqHz: BAND.maxFreqHz,
                  onsetThreshold: 0.5,
                  frameThreshold: 0.3,
                },
              );
              est = extracted.deduced.map((n) => ({
                onsetSec: n.startTimeSeconds,
                durSec: n.durationSeconds,
                midi: n.pitchMidi,
              }));
            } else {
              const k = cfg.factor;
              // Decode at 16 kHz × k; CREPE reads the result as 16 kHz, so the
              // whole clip plays 1/k speed and every frequency divides by k.
              // The high-pass runs at decode time, i.e. on the REAL axis.
              const decoded = await decoder.decode(buf, CREPE_SR * k, {
                loudnorm: provider.normalizeLoudness,
                highpassHz: BAND.highpassHz,
              });
              const semis = Math.round(12 * Math.log2(k));
              let confidenceThreshold = 0.5;
              if (cfg.reverbRamp) {
                // The resolver's constants (profile-resolver.ts): relief 0.25
                // per unit reverberance, floor 0.25, estimated at 16 kHz.
                const det = await decoder.decode(buf, CREPE_SR, {
                  loudnorm: false,
                  highpassHz: 30,
                });
                const reverberance = estimateReverberance(det.samples, CREPE_SR);
                confidenceThreshold = Math.max(0.25, 0.5 - 0.25 * reverberance);
              }
              const extracted = await new AudioConverter(provider).convert(
                decoded.samples,
                // Model-domain tempo: a beat lasts k× as many model seconds.
                { bpm: truth.bpm / k },
                undefined,
                {
                  minFreqHz: Math.max(33, BAND.minFreqHz / k),
                  maxFreqHz: Math.min(CREPE_CEILING_HZ, BAND.maxFreqHz / k),
                  confidenceThreshold,
                  // Keep the REAL-time note floor: model frames are 20 ms of
                  // model time = 20/k ms of real time.
                  minFramesPerNote: Math.round((FLOOR_MS / 20) * k),
                },
              );
              est = extracted.deduced.map((n) => ({
                onsetSec: n.startTimeSeconds / k,
                durSec: n.durationSeconds / k,
                midi: n.pitchMidi + semis,
              }));
            }
          } catch (err) {
            console.warn(`  ! ${scenario.id}/${melody}__${conditionId} [${cfg.name}]: ${String(err)}`);
          }
          const f1 = scoreNotesBest(truth, est, {
            onsetTolSec: 0.1,
            timingTolSec: 0.3,
          }).f1;
          f1ByConfig.get(cfg.name)!.push(f1);
          if (!perScenario.has(scenario.id)) perScenario.set(scenario.id, new Map());
          if (!perScenario.get(scenario.id)!.has(cfg.name)) perScenario.get(scenario.id)!.set(cfg.name, []);
          perScenario.get(scenario.id)!.get(cfg.name)!.push(f1);
          if (!perCondition.has(conditionId)) perCondition.set(conditionId, new Map());
          if (!perCondition.get(conditionId)!.has(cfg.name)) perCondition.get(conditionId)!.set(cfg.name, []);
          perCondition.get(conditionId)!.get(cfg.name)!.push(f1);
        }
      }
    }
    console.log(`${scenario.id} done`);
  }

  console.log(`\nclips=${clipKeys.length}  (floor ${FLOOR_MS} ms real time)`);
  console.log('\n--- mean COnP@0.1 per scenario ---');
  const header = 'config'.padEnd(22) + [...perScenario.keys()].map((s) => s.padEnd(19)).join('') + 'ALL';
  console.log(header);
  for (const cfg of CONFIGS) {
    console.log(
      cfg.name.padEnd(22) +
        [...perScenario.keys()]
          .map((s) => mean(perScenario.get(s)!.get(cfg.name) ?? []).toFixed(3).padEnd(19))
          .join('') +
        mean(f1ByConfig.get(cfg.name)!).toFixed(3),
    );
  }

  console.log('\n--- mean COnP@0.1 per condition ---');
  console.log('config'.padEnd(22) + [...perCondition.keys()].map((c) => c.slice(0, 12).padEnd(14)).join(''));
  for (const cfg of CONFIGS) {
    console.log(
      cfg.name.padEnd(22) +
        [...perCondition.keys()]
          .map((c) => mean(perCondition.get(c)!.get(cfg.name) ?? []).toFixed(3).padEnd(14))
          .join(''),
    );
  }

  const baseline = f1ByConfig.get('basic-pitch (ships)')!;
  console.log('\n--- vs basic-pitch, paired bootstrap over clips (* = CI excludes 0) ---');
  for (const cfg of CONFIGS) {
    if (cfg.name === 'basic-pitch (ships)') continue;
    console.log(
      `${cfg.name.padEnd(22)} ${formatComparison(pairedDiffCI(baseline, f1ByConfig.get(cfg.name)!))}`,
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
