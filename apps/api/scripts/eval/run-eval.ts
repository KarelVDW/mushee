/**
 * Run the audio→notes pipeline over the generated corpus under a FIXED config
 * (provider + frequency window + highpass + thresholds) and score each clip
 * against its ground truth. Aggregates per scenario and overall.
 *
 * Config is read from env so the tuning workflow can sweep without editing
 * files. With no overrides this measures the pipeline's current defaults (the
 * baseline). Examples:
 *
 *   tsx scripts/eval/run-eval.ts                       # baseline, all clips
 *   EVAL_PROVIDER=basic-pitch EVAL_MAX_FREQ=4000 \
 *   EVAL_SCENARIOS=whistle-high,whistle-mid \
 *   tsx scripts/eval/run-eval.ts
 *
 * Env:
 *   EVAL_PROVIDER     basic-pitch | crepe-tiny | crepe-full | pesto  (default basic-pitch)
 *   EVAL_MIN_FREQ, EVAL_MAX_FREQ, EVAL_CONFIDENCE, EVAL_HIGHPASS
 *   EVAL_ONSET, EVAL_FRAME           (basic-pitch note gates)
 *   EVAL_SCENARIOS, EVAL_CONDITIONS  comma-separated id filters
 *   EVAL_OUT          report path (default fixtures/eval/report.json)
 *   EVAL_LABEL        label stored in the report (e.g. the config name)
 */

import { readFileSync, writeFileSync, existsSync, readdirSync } from 'fs';
import { resolve, join } from 'path';

import { AudioConverter } from '../../src/recordings/AudioConverter';
import { AudioDecoder } from '../../src/recordings/AudioDecoder';
import { ProfileResolver } from '../../src/recordings/profiles/ProfileResolver';
import { BasicPitchProvider } from '../../src/recordings/providers/BasicPitchProvider';
import { CrepeProvider } from '../../src/recordings/providers/CrepeProvider';
import { PestoProvider } from '../../src/recordings/providers/PestoProvider';
import type {
  PitchProvider,
  PitchTranscribeOptions,
} from '../../src/recordings/providers/PitchProvider';
import { ProviderRegistry } from '../../src/recordings/providers/ProviderRegistry';
import { scoreNotes, type Metrics, type EstNote } from './lib/metrics';
import { SCENARIOS, CONDITIONS } from './scenarios';
import type { GroundTruth, Scenario } from './types';

const DETECT_SR = 16000;

const EVAL_ROOT = resolve(__dirname, '../fixtures/eval');
const MODELS = {
  basicPitch: resolve(process.cwd(), 'model'),
  crepeFull: resolve(process.cwd(), 'model-crepe-full'),
  crepeTiny: resolve(process.cwd(), 'model-crepe-tiny'),
  pesto: resolve(process.cwd(), 'model-pesto'),
};

function buildProvider(name: string): PitchProvider {
  switch (name) {
    case 'crepe':
    case 'crepe-full':
      return new CrepeProvider(MODELS.crepeFull, 'crepe-full');
    case 'crepe-tiny':
      return new CrepeProvider(MODELS.crepeTiny, 'crepe-tiny');
    case 'pesto':
      return new PestoProvider(MODELS.pesto);
    case 'basic-pitch':
    default:
      return new BasicPitchProvider(MODELS.basicPitch);
  }
}

function numEnv(key: string): number | undefined {
  const v = process.env[key];
  return v === undefined || v === '' ? undefined : Number(v);
}

function listEnv(key: string): string[] | undefined {
  const v = process.env[key];
  return v ? v.split(',').map((s) => s.trim()).filter(Boolean) : undefined;
}

interface ClipResult {
  scenario: string;
  melody: string;
  condition: string;
  metrics: Metrics;
}

function mean(xs: number[]): number {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
}

async function main(): Promise<void> {
  const providerName = process.env.EVAL_PROVIDER ?? 'basic-pitch';
  const pitchOptions: PitchTranscribeOptions = {
    minFreqHz: numEnv('EVAL_MIN_FREQ'),
    maxFreqHz: numEnv('EVAL_MAX_FREQ'),
    confidenceThreshold: numEnv('EVAL_CONFIDENCE'),
    onsetThreshold: numEnv('EVAL_ONSET'),
    frameThreshold: numEnv('EVAL_FRAME'),
  };
  const highpassHz = numEnv('EVAL_HIGHPASS') ?? 80;
  const scenarioFilter = listEnv('EVAL_SCENARIOS');
  const conditionFilter = listEnv('EVAL_CONDITIONS');
  const outPath = process.env.EVAL_OUT ?? join(EVAL_ROOT, 'report.json');
  // Adaptive mode runs the real resolver+registry (the production path).
  const adaptive = ['1', 'true', 'yes'].includes(
    (process.env.EVAL_ADAPTIVE ?? '').toLowerCase(),
  );
  const noHint = ['1', 'true', 'yes'].includes(
    (process.env.EVAL_NO_HINT ?? '').toLowerCase(),
  );
  // Onset-split is on by default; EVAL_NO_ONSET_SPLIT=1 disables it for A/B.
  const onsetSplit = !['1', 'true', 'yes'].includes(
    (process.env.EVAL_NO_ONSET_SPLIT ?? '').toLowerCase(),
  );
  const label = process.env.EVAL_LABEL ?? (adaptive ? 'adaptive' : providerName);

  const decoder = new AudioDecoder();

  // --- Transcription strategy: fixed config, or full adaptive pipeline. ---
  let transcribe: (scenario: Scenario, buf: Buffer, bpm: number) => Promise<EstNote[]>;

  if (adaptive) {
    const registry = new ProviderRegistry({
      basicPitch: MODELS.basicPitch,
      crepeFull: MODELS.crepeFull,
      crepeTiny: MODELS.crepeTiny,
      pesto: MODELS.pesto,
    });
    await registry.initAll();
    const resolver = new ProfileResolver();
    transcribe = async (scenario, buf, bpm) => {
      const det = await decoder.decode(buf, DETECT_SR, {
        loudnorm: false,
        highpassHz: 30,
      });
      const profile = resolver.resolve(det.samples, DETECT_SR, {
        instrumentId: noHint ? undefined : scenario.instrumentId,
      });
      const provider = registry.get(profile.providerName);
      const decoded = await decoder.decode(buf, provider.sampleRate, {
        loudnorm: provider.normalizeLoudness,
        highpassHz: profile.highpassHz,
      });
      const extracted = await new AudioConverter(provider, undefined, onsetSplit).convert(
        decoded.samples,
        { bpm },
        undefined,
        {
          minFreqHz: profile.minFreqHz,
          maxFreqHz: profile.maxFreqHz,
          confidenceThreshold: profile.confidenceThreshold,
          onsetThreshold: profile.onsetThreshold,
          frameThreshold: profile.frameThreshold,
        },
      );
      return extracted.deduced.map((n) => ({
        onsetSec: n.startTimeSeconds,
        durSec: n.durationSeconds,
        midi: n.pitchMidi,
      }));
    };
  } else {
    const provider = buildProvider(providerName);
    await provider.init();
    transcribe = async (_scenario, buf, bpm) => {
      const decoded = await decoder.decode(buf, provider.sampleRate, {
        loudnorm: provider.normalizeLoudness,
        highpassHz,
      });
      const extracted = await new AudioConverter(provider, undefined, onsetSplit).convert(
        decoded.samples,
        { bpm },
        undefined,
        pitchOptions,
      );
      return extracted.deduced.map((n) => ({
        onsetSec: n.startTimeSeconds,
        durSec: n.durationSeconds,
        midi: n.pitchMidi,
      }));
    };
  }

  const scenarios = SCENARIOS.filter(
    (s) => !scenarioFilter || scenarioFilter.includes(s.id),
  );
  const conditions = CONDITIONS.filter(
    (c) => !conditionFilter || conditionFilter.includes(c.id),
  );

  const results: ClipResult[] = [];

  for (const scenario of scenarios) {
    const dir = join(EVAL_ROOT, scenario.id);
    if (!existsSync(dir)) continue;
    const truths = readdirSync(dir).filter((f) => f.endsWith('.truth.json'));

    for (const truthFile of truths) {
      const melody = truthFile.replace('.truth.json', '');
      const truth = JSON.parse(
        readFileSync(join(dir, truthFile), 'utf8'),
      ) as GroundTruth;

      for (const condition of conditions) {
        const wav = join(dir, `${melody}__${condition.id}.wav`);
        if (!existsSync(wav)) continue;

        let est: EstNote[] = [];
        try {
          const buf = readFileSync(wav);
          est = await transcribe(scenario, buf, truth.bpm);
        } catch (err) {
          // A clip that won't decode/convert scores as zero rather than
          // aborting the whole sweep.
          console.warn(`  ! ${scenario.id}/${melody}__${condition.id}: ${String(err)}`);
        }
        results.push({
          scenario: scenario.id,
          melody,
          condition: condition.id,
          metrics: scoreNotes(truth.notes, est),
        });
      }
    }
    // Per-scenario line as we go (long runs).
    const sc = results.filter((r) => r.scenario === scenario.id);
    const f1 = mean(sc.map((r) => r.metrics.f1));
    const oct = mean(sc.map((r) => r.metrics.octaveErrorRate));
    console.log(
      `  ${scenario.id.padEnd(18)} F1=${f1.toFixed(2)}  octErr=${oct.toFixed(2)}  (${sc.length} clips)`,
    );
  }

  // Aggregate per scenario.
  const perScenario = scenarios.map((s) => {
    const rs = results.filter((r) => r.scenario === s.id);
    return {
      scenario: s.id,
      label: s.label,
      clips: rs.length,
      f1: mean(rs.map((r) => r.metrics.f1)),
      chromaF1: mean(rs.map((r) => r.metrics.chromaF1)),
      precision: mean(rs.map((r) => r.metrics.precision)),
      recall: mean(rs.map((r) => r.metrics.recall)),
      octaveErrorRate: mean(rs.map((r) => r.metrics.octaveErrorRate)),
      medianPitchErr: mean(rs.map((r) => r.metrics.medianPitchErr)),
    };
  });

  const overallF1 = mean(perScenario.map((s) => s.f1));
  const report = {
    label,
    mode: adaptive ? (noHint ? 'adaptive-no-hint' : 'adaptive') : 'fixed',
    provider: adaptive ? 'registry' : providerName,
    config: adaptive ? { adaptive: true } : { ...pitchOptions, highpassHz },
    overallF1,
    perScenario,
    clips: results.map((r) => ({
      scenario: r.scenario,
      melody: r.melody,
      condition: r.condition,
      ...r.metrics,
    })),
  };
  writeFileSync(outPath, JSON.stringify(report, null, 2));

  console.log(`\n=== ${label} (${report.mode}) ===`);
  console.log(
    'scenario'.padEnd(20) + 'F1'.padEnd(7) + 'chromaF1'.padEnd(10) + 'octErr',
  );
  for (const s of perScenario) {
    console.log(
      s.scenario.padEnd(20) +
        s.f1.toFixed(2).padEnd(7) +
        s.chromaF1.toFixed(2).padEnd(10) +
        s.octaveErrorRate.toFixed(2),
    );
  }
  console.log(`\nOVERALL mean F1 = ${overallF1.toFixed(3)}`);
  console.log(`Report written to ${outPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
