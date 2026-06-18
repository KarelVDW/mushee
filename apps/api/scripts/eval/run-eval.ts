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
 *   EVAL_PROVIDER     basic-pitch | crepe-tiny  (default basic-pitch)
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
import type {
  PitchProvider,
  PitchTranscribeOptions,
} from '../../src/recordings/providers/PitchProvider';
import { ProviderRegistry } from '../../src/recordings/providers/ProviderRegistry';
import {
  scoreNotes,
  timingStats,
  type Metrics,
  type EstNote,
  type MatchOptions,
} from './lib/metrics';
import { discoverRealDatasets } from './lib/realCorpus';
import { SCENARIOS, CONDITIONS } from './scenarios';
import type { Condition, GroundTruth, Scenario } from './types';

const DETECT_SR = 16000;

// Synthetic corpus (generate.ts) vs. real recorded corpus (fetch-*.ts). The
// latter is selected with EVAL_REAL=1.
const SYNTH_ROOT = resolve(__dirname, '../fixtures/eval');
const REAL_ROOT = resolve(__dirname, '../fixtures/eval-real');
const MODELS = {
  basicPitch: resolve(process.cwd(), 'model'),
  crepeTiny: resolve(process.cwd(), 'model-crepe-tiny'),
};

function buildProvider(name: string): PitchProvider {
  switch (name) {
    case 'crepe-tiny':
      return new CrepeProvider(MODELS.crepeTiny, 'crepe-tiny');
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

function boolEnv(key: string): boolean {
  return ['1', 'true', 'yes'].includes((process.env[key] ?? '').toLowerCase());
}

/**
 * Real corpus (EVAL_REAL): datasets are discovered from fixtures/eval-real
 * rather than the synthetic melody×register matrix. rootMidi is irrelevant for
 * recorded clips (nothing is synthesized), so it's zeroed.
 */
function discoverRealScenarios(root: string): Scenario[] {
  return discoverRealDatasets(root).map((d) => ({
    id: d.id,
    label: d.label,
    kind: d.kind,
    instrumentId: d.instrumentId,
    rootMidi: 0,
  }));
}

// Real clips ship as `<clip>__real.wav`; the harness's per-condition WAV lookup
// reuses this single pseudo-condition (no synthetic degradation is applied).
const REAL_CONDITION: Condition = { id: 'real', label: 'real recording' };

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
  // Real recorded corpus vs. the synthetic one; picks the fixtures root.
  const realMode = boolEnv('EVAL_REAL');
  const evalRoot = realMode ? REAL_ROOT : SYNTH_ROOT;
  const outPath = process.env.EVAL_OUT ?? join(evalRoot, 'report.json');
  // Onset window for the F1 match gate; separate, wider window for the timing
  // diagnostic so late notes report their true error instead of being dropped.
  const matchOpts: MatchOptions = {
    onsetTolSec: numEnv('EVAL_ONSET_TOL') ?? 0.1,
    timingTolSec: numEnv('EVAL_TIMING_TOL') ?? 0.3,
  };
  // Adaptive mode runs the real resolver+registry (the production path).
  const adaptive = boolEnv('EVAL_ADAPTIVE');
  const noHint = boolEnv('EVAL_NO_HINT');
  // Onset-split is on by default; EVAL_NO_ONSET_SPLIT=1 disables it for A/B.
  const onsetSplit = !boolEnv('EVAL_NO_ONSET_SPLIT');
  const label = process.env.EVAL_LABEL ?? (adaptive ? 'adaptive' : providerName);

  const decoder = new AudioDecoder();

  // --- Transcription strategy: fixed config, or full adaptive pipeline. ---
  let transcribe: (scenario: Scenario, buf: Buffer, bpm: number) => Promise<EstNote[]>;

  if (adaptive) {
    const registry = new ProviderRegistry({
      basicPitch: MODELS.basicPitch,
      crepeTiny: MODELS.crepeTiny,
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

  const allScenarios = realMode ? discoverRealScenarios(evalRoot) : SCENARIOS;
  const scenarios = allScenarios.filter(
    (s) => !scenarioFilter || scenarioFilter.includes(s.id),
  );
  const allConditions = realMode ? [REAL_CONDITION] : CONDITIONS;
  const conditions = allConditions.filter(
    (c) => !conditionFilter || conditionFilter.includes(c.id),
  );

  const results: ClipResult[] = [];

  for (const scenario of scenarios) {
    const dir = join(evalRoot, scenario.id);
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
          metrics: scoreNotes(truth.notes, est, matchOpts),
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

  // Aggregate per scenario. Timing is pooled across the scenario's matched
  // notes (not a mean of per-clip means), so the bias/spread reflect the real
  // distribution and aren't diluted by clips with few matches.
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
      timing: timingStats(
        rs.flatMap((r) => r.metrics.timing.onsetDeltasMs),
        rs.flatMap((r) => r.metrics.timing.offsetDeltasMs),
      ),
    };
  });

  const overallTiming = timingStats(
    results.flatMap((r) => r.metrics.timing.onsetDeltasMs),
    results.flatMap((r) => r.metrics.timing.offsetDeltasMs),
  );
  const overallF1 = mean(perScenario.map((s) => s.f1));
  const report = {
    label,
    mode: adaptive ? (noHint ? 'adaptive-no-hint' : 'adaptive') : 'fixed',
    provider: adaptive ? 'registry' : providerName,
    config: adaptive ? { adaptive: true } : { ...pitchOptions, highpassHz },
    matchTol: matchOpts,
    overallF1,
    overallTiming,
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

  // Timing diagnostic (signed ms over exact-pitch matches; + = pipeline late).
  // bias/median = systematic offset (fixable by calibration); std = jitter
  // (already absorbed by quantization); n = matched notes the stats rest on.
  console.log(
    `\n--- onset timing (signed ms, + = late, window ±${(matchOpts.timingTolSec * 1000).toFixed(0)}ms) ---`,
  );
  console.log(
    'scenario'.padEnd(20) +
      'bias'.padEnd(8) +
      'median'.padEnd(8) +
      'std'.padEnd(8) +
      'mae'.padEnd(8) +
      'offBias'.padEnd(9) +
      'n',
  );
  for (const s of perScenario) {
    const t = s.timing;
    console.log(
      s.scenario.padEnd(20) +
        t.onsetBiasMs.toFixed(0).padEnd(8) +
        t.onsetMedianMs.toFixed(0).padEnd(8) +
        t.onsetStdMs.toFixed(0).padEnd(8) +
        t.onsetMaeMs.toFixed(0).padEnd(8) +
        t.offsetBiasMs.toFixed(0).padEnd(9) +
        String(t.matched),
    );
  }
  console.log(
    `\nOVERALL onset bias=${overallTiming.onsetBiasMs.toFixed(1)}ms ` +
      `median=${overallTiming.onsetMedianMs.toFixed(1)}ms ` +
      `std=${overallTiming.onsetStdMs.toFixed(1)}ms ` +
      `mae=${overallTiming.onsetMaeMs.toFixed(1)}ms ` +
      `offsetBias=${overallTiming.offsetBiasMs.toFixed(1)}ms ` +
      `(n=${overallTiming.matched})`,
  );
  console.log(`Report written to ${outPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
