/**
 * The corpus scorer behind `run-eval.ts` and `benchmark.ts`: run the audio→notes
 * pipeline over a corpus (synthetic or real), score every clip against its
 * ground truth, aggregate per dataset / per condition / per MATERIAL.
 *
 * Extracted from run-eval.ts so the benchmark runner and the everyday tuning
 * entry point cannot drift apart: both call `runEval()` with an options object;
 * run-eval.ts only adds env parsing and console printing, benchmark.ts only adds
 * provenance (git SHA, date) and the committed results/compare machinery.
 *
 * Two scoring rules keep the headline number honest:
 *   - A clip carrying several independent annotations is scored against the one
 *     it matches best (`scoreNotesBest`): annotators disagree about ornament
 *     grouping, and charging the pipeline for that measures taste, not accuracy.
 *   - Datasets whose truth is derived (`noteTruthDerived`), pitchless, or a
 *     constructed performance are reported per-dataset but excluded from every
 *     pooled aggregate — see lib/realCorpus.ts for each flag's reasoning.
 */

import { existsSync, readdirSync, readFileSync } from 'fs';
import { join, resolve } from 'path';

import { AudioConverter } from '../../../src/recordings/pipeline/audio-converter';
import { AudioDecoder } from '../../../src/recordings/pipeline/audio-decoder';
import { ProfileResolver } from '../../../src/recordings/pipeline/profiles/profile-resolver';
import { CrepePitchdownProvider } from '../../../src/recordings/pipeline/providers/crepe-pitchdown-provider';
import { CrepeProvider } from '../../../src/recordings/pipeline/providers/crepe-provider';
import { LocalModelBackend } from '../../../src/recordings/pipeline/providers/local-model-backend';
import type {
  PitchProvider,
  PitchTranscribeOptions,
} from '../../../src/recordings/pipeline/providers/pitch-provider';
import { ProviderRegistry } from '../../../src/recordings/pipeline/providers/provider-registry';
import { CONDITIONS, SCENARIOS } from '../scenarios';
import type { Condition, GroundTruth, Scenario } from '../types';
import {
  type EstNote,
  type MatchOptions,
  type Metrics,
  scoreNotesBest,
  scoreOnsets,
  timingStats,
  type TimingStats,
} from './metrics';
import {
  addOnsetClassStats,
  emptyOnsetClassStats,
  type OnsetClassStats,
  onsetRecallByClass,
} from './onsetClasses';
import { discoverRealDatasets, type Material, type RealDataset } from './realCorpus';
import { repairSecondsPer100, type SegErrorCounts, segErrors } from './segErrors';
import { splitOf } from './split';

const DETECT_SR = 16000;

export const SYNTH_ROOT = resolve(__dirname, '../../fixtures/eval');
export const REAL_ROOT = resolve(__dirname, '../../fixtures/eval-real');
const MODELS = {
  crepeTiny: resolve(process.cwd(), 'model-crepe-tiny'),
};

// Real clips ship as `<clip>__real.wav`; the harness's per-condition WAV lookup
// reuses this pseudo-condition. Degraded variants of the real clips (see
// degrade-real.ts) reuse the synthetic condition ids — missing variants are
// simply skipped, so running before degrade-real.ts still works.
export const REAL_CONDITION: Condition = { id: 'real', label: 'real recording' };

export interface EvalOptions {
  /** Real recorded corpus (fixtures/eval-real) vs the synthetic one. */
  real: boolean;
  /** Run the production resolver + registry (the adaptive path) instead of a fixed config. */
  adaptive: boolean;
  /** Fixed-config provider (ignored when adaptive). */
  providerName: string;
  pitchOptions: PitchTranscribeOptions;
  highpassHz: number;
  fixedDenoise: boolean;
  /** Restrict to these dataset / scenario ids. */
  scenarioFilter?: string[];
  /** Restrict to these condition ids. */
  conditionFilter?: string[];
  /** Strip the instrument hint AND the explicit sourceKind (exercises the source classifier). */
  noHint: boolean;
  onsetSplit: boolean;
  label: string;
  matchOpts: MatchOptions;
  /** Pool derived / pitchless / constructed datasets into the headline anyway. */
  includeUntrusted: boolean;
  /** Progress line per finished dataset. */
  onProgress?: (line: string) => void;
}

export function defaultEvalOptions(over: Partial<EvalOptions> = {}): EvalOptions {
  return {
    real: false,
    adaptive: false,
    providerName: 'crepe-tiny',
    pitchOptions: {},
    highpassHz: 80,
    fixedDenoise: false,
    noHint: false,
    onsetSplit: true,
    label: 'adaptive',
    matchOpts: { onsetTolSec: 0.1, timingTolSec: 0.3 },
    includeUntrusted: false,
    ...over,
  };
}

/** One scored clip × condition. */
export interface ClipResult {
  scenario: string;
  melody: string;
  condition: string;
  /** Harness dev/test half (performer-grouped, lib/split.ts). */
  split: 'dev' | 'test';
  metrics: Metrics;
  /**
   * Molina split/merged/missed/spurious for this clip, and the onset taxonomy.
   * Reported in the headline run because these are the numbers the segmentation
   * effort targets and F1 hides them: "12 notes for 8" and "6 notes for 8" can
   * share an F1 and be very different products.
   */
  seg: SegErrorCounts;
  onsets: OnsetClassStats;
  /** MIREX COn (onset-only) — the only meaningful score for `pitchless` datasets. */
  onsetOnly: { precision: number; recall: number; f1: number };
}

export interface ScenarioAggregate {
  scenario: string;
  label: string;
  kind: string;
  material: Material;
  tier: 'benchmark' | 'context' | 'synthetic';
  license?: string;
  licenceRestricted: boolean;
  clips: number;
  /** False = reported for information only, kept out of the aggregates. */
  pooled: boolean;
  noteTruthDerived: boolean;
  pitchless: boolean;
  constructedPerformance: boolean;
  onsetF1: number;
  onsetPrecision: number;
  onsetRecall: number;
  f1: number;
  f1Off: number;
  chromaF1: number;
  precision: number;
  recall: number;
  octaveErrorRate: number;
  medianPitchErr: number;
  timing: TimingStats;
  seg: SegErrorCounts;
  repairSecondsPer100: number;
  onsets: OnsetClassStats;
}

export interface ConditionAggregate {
  condition: string;
  label: string;
  clips: number;
  f1: number;
  f1Off: number;
  precision: number;
  recall: number;
  octaveErrorRate: number;
}

/**
 * The material-level summary the product benchmark reads first: for each
 * material, the mean over its POOLED datasets (the headline convention — a mean
 * of dataset means, so a 400-clip corpus does not drown a 40-clip one) plus the
 * context-only datasets listed separately so nobody mistakes them for a gate.
 */
export interface MaterialAggregate {
  material: Material;
  /**
   * True when no benchmark-grade dataset exists for this material and the
   * numbers below come from the context-tier datasets instead (derived or
   * prescribed truth, restricted licences). A PROVISIONAL row: it lets a
   * material be tracked over time, and it must never gate a decision or enter
   * the overall headline. Which datasets it rests on is listed in `datasets`.
   */
  provisional: boolean;
  /** Datasets behind the number (benchmark-grade, or the provisional set). */
  datasets: string[];
  clips: number;
  f1: number;
  f1Off: number;
  precision: number;
  recall: number;
  repairSecondsPer100: number;
  /** Datasets of this material that are reported but never pooled. */
  contextDatasets: string[];
}

export interface EvalReport {
  label: string;
  mode: 'adaptive' | 'adaptive-no-hint' | 'fixed';
  provider: string;
  config: Record<string, unknown>;
  matchTol: MatchOptions;
  overallF1: number;
  overallF1Off: number;
  notePooling: {
    includeUntrusted: boolean;
    derivedNoteTruth: string[];
    pitchless: string[];
    constructedPerformance: string[];
    excludedFromOverall: string[];
  };
  overallTiming: TimingStats;
  perMaterial: MaterialAggregate[];
  perScenario: ScenarioAggregate[];
  perCondition: ConditionAggregate[];
  segErrors: SegErrorCounts;
  repairSecondsPer100: number;
  onsetClasses: OnsetClassStats;
  clips: Array<
    { scenario: string; melody: string; condition: string; split: 'dev' | 'test' } & Metrics & {
      seg: SegErrorCounts;
      onsetOnly: ClipResult['onsetOnly'];
    }
  >;
}

type EvalScenario = Scenario & {
  dir?: string;
  material: Material;
  tier: ScenarioAggregate['tier'];
  license?: string;
  licenceRestricted: boolean;
};

function buildProvider(name: string): PitchProvider {
  const backend = new LocalModelBackend({ crepeTiny: MODELS.crepeTiny });
  switch (name) {
    case 'crepe-tiny-down1':
      return new CrepePitchdownProvider(backend);
    case 'crepe-tiny':
    default:
      return new CrepeProvider(backend, 'crepe-tiny');
  }
}

/**
 * Real corpus: datasets are discovered from fixtures/eval-real rather than the
 * synthetic melody×register matrix. rootMidi is irrelevant for recorded clips
 * (nothing is synthesized), so it's zeroed. `dir` carries the dataset's actual
 * directory — since the benchmark/context tiering, datasets live one level below
 * the eval-real root, so `join(root, id)` no longer resolves them.
 */
function realScenarios(datasets: RealDataset[]): EvalScenario[] {
  return datasets.map((d) => ({
    id: d.id,
    label: d.label,
    kind: d.kind,
    instrumentId: d.instrumentId,
    rootMidi: 0,
    dir: d.dir,
    material: d.material,
    tier: d.tier,
    license: d.license,
    licenceRestricted: d.licenceRestricted ?? false,
  }));
}

function syntheticScenarios(): EvalScenario[] {
  return SCENARIOS.map((s) => ({
    ...s,
    material:
      s.kind === 'whistle' ? 'whistling' : s.kind === 'instrument' ? 'instrument' : 'singing',
    tier: 'synthetic',
    licenceRestricted: false,
  }));
}

export function emptySegErrors(): SegErrorCounts {
  return {
    clean: 0, split: 0, merged: 0, missed: 0, spurious: 0,
    tangled: 0, pitchWrong: 0, refTotal: 0, estTotal: 0,
  };
}

export function sumSegErrors(rs: Array<{ seg: SegErrorCounts }>): SegErrorCounts {
  const total = emptySegErrors();
  for (const r of rs) {
    for (const k of Object.keys(total) as Array<keyof SegErrorCounts>) {
      total[k] += r.seg[k];
    }
  }
  return total;
}

function sumOnsetClasses(rs: ClipResult[]): OnsetClassStats {
  const total = emptyOnsetClassStats();
  for (const r of rs) addOnsetClassStats(total, r.onsets);
  return total;
}

export function mean(xs: number[]): number {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
}

type Transcribe = (scenario: Scenario, buf: Buffer, bpm: number) => Promise<EstNote[]>;

async function buildTranscriber(o: EvalOptions, decoder: AudioDecoder): Promise<Transcribe> {
  if (o.adaptive) {
    const registry = new ProviderRegistry({ crepeTiny: MODELS.crepeTiny });
    await registry.initAll();
    const resolver = new ProfileResolver();
    return async (scenario, buf, bpm) => {
      const det = await decoder.decode(buf, DETECT_SR, { loudnorm: false, highpassHz: 30 });
      const profile = resolver.resolve(det.samples, DETECT_SR, {
        instrumentId: o.noHint ? undefined : scenario.instrumentId,
        // The corpus knows what each dataset is; in the app this is either the
        // client's declaration or (since the source classifier) the audio
        // itself. ALWAYS explicit here — including for instruments — so eval
        // numbers measure the pipeline, not the classifier's day. Suppressed
        // under noHint, which is also how to exercise the classifier end-to-end.
        sourceKind: o.noHint ? undefined : scenario.kind === 'voice' ? 'voice' : 'instrument',
      });
      const provider = registry.get(profile.providerName);
      const decoded = await decoder.decode(buf, provider.sampleRate, {
        loudnorm: provider.normalizeLoudness,
        highpassHz: profile.highpassHz,
        denoise: profile.denoise,
      });
      const extracted = await new AudioConverter(provider, {
        enableOnsetSplit: o.onsetSplit,
        profile,
      }).convert(decoded.samples, { bpm }, undefined, {
        minFreqHz: profile.minFreqHz,
        maxFreqHz: profile.maxFreqHz,
        confidenceThreshold: profile.confidenceThreshold,
        minFramesPerNote: profile.minFramesPerNote,
        segmentMode: profile.segmentMode,
        smoothFrames: profile.smoothFrames,
      });
      return extracted.deduced.map((n) => ({
        onsetSec: n.startTimeSeconds,
        durSec: n.durationSeconds,
        midi: n.pitchMidi,
      }));
    };
  }
  const provider = buildProvider(o.providerName);
  await provider.init();
  return async (_scenario, buf, bpm) => {
    const decoded = await decoder.decode(buf, provider.sampleRate, {
      loudnorm: provider.normalizeLoudness,
      highpassHz: o.highpassHz,
      denoise: o.fixedDenoise,
    });
    const extracted = await new AudioConverter(provider, {
      enableOnsetSplit: o.onsetSplit,
    }).convert(decoded.samples, { bpm }, undefined, o.pitchOptions);
    return extracted.deduced.map((n) => ({
      onsetSec: n.startTimeSeconds,
      durSec: n.durationSeconds,
      midi: n.pitchMidi,
    }));
  };
}

/** Which conditions a corpus can be scored under (real gets the `real` pseudo-condition first). */
export function conditionsFor(real: boolean): Condition[] {
  return real ? [REAL_CONDITION, ...CONDITIONS.filter((c) => c.id !== 'clean')] : CONDITIONS;
}

export async function runEval(o: EvalOptions): Promise<EvalReport> {
  const evalRoot = o.real ? REAL_ROOT : SYNTH_ROOT;
  const decoder = new AudioDecoder();
  const transcribe = await buildTranscriber(o, decoder);

  const datasets = o.real ? discoverRealDatasets(evalRoot) : [];
  const derivedNoteTruth = new Set(datasets.filter((d) => d.noteTruthDerived).map((d) => d.id));
  const pitchlessIds = new Set(datasets.filter((d) => d.pitchless).map((d) => d.id));
  const constructedIds = new Set(
    datasets.filter((d) => d.constructedPerformance).map((d) => d.id),
  );
  const pooled = (scenarioId: string): boolean =>
    o.includeUntrusted ||
    (!derivedNoteTruth.has(scenarioId) &&
      !pitchlessIds.has(scenarioId) &&
      !constructedIds.has(scenarioId));

  const allScenarios = o.real ? realScenarios(datasets) : syntheticScenarios();
  const scenarios = allScenarios.filter(
    (s) => !o.scenarioFilter || o.scenarioFilter.includes(s.id),
  );
  const conditions = conditionsFor(o.real).filter(
    (c) => !o.conditionFilter || o.conditionFilter.includes(c.id),
  );

  const results: ClipResult[] = [];
  for (const scenario of scenarios) {
    const dir = scenario.dir ?? join(evalRoot, scenario.id);
    if (!existsSync(dir)) continue;
    const truths = readdirSync(dir).filter((f) => f.endsWith('.truth.json'));

    for (const truthFile of truths) {
      const melody = truthFile.replace('.truth.json', '');
      const truth = JSON.parse(readFileSync(join(dir, truthFile), 'utf8')) as GroundTruth;

      for (const condition of conditions) {
        const wav = join(dir, `${melody}__${condition.id}.wav`);
        if (!existsSync(wav)) continue;

        let est: EstNote[] = [];
        try {
          est = await transcribe(scenario, readFileSync(wav), truth.bpm);
        } catch (err) {
          // A clip that won't decode/convert scores as zero rather than
          // aborting the whole run.
          console.warn(`  ! ${scenario.id}/${melody}__${condition.id}: ${String(err)}`);
        }
        results.push({
          scenario: scenario.id,
          melody,
          condition: condition.id,
          split: splitOf(scenario.id, melody),
          metrics: scoreNotesBest(truth, est, o.matchOpts),
          seg: segErrors(truth.notes, est),
          onsets: onsetRecallByClass(truth.notes, est, o.matchOpts.onsetTolSec),
          onsetOnly: scoreOnsets(truth.notes, est, o.matchOpts.onsetTolSec),
        });
      }
    }
    const sc = results.filter((r) => r.scenario === scenario.id);
    o.onProgress?.(
      `  ${scenario.id.padEnd(30)} COnP@0.1=${mean(sc.map((r) => r.metrics.f1)).toFixed(2)}` +
        `  octErr=${mean(sc.map((r) => r.metrics.octaveErrorRate)).toFixed(2)}  (${sc.length} clips)`,
    );
  }

  // Aggregate per scenario. Timing is pooled across the scenario's matched
  // notes (not a mean of per-clip means), so the bias/spread reflect the real
  // distribution and aren't diluted by clips with few matches.
  const perScenario: ScenarioAggregate[] = scenarios.map((s) => {
    const rs = results.filter((r) => r.scenario === s.id);
    return {
      scenario: s.id,
      label: s.label,
      kind: s.kind,
      material: s.material,
      tier: s.tier,
      license: s.license,
      licenceRestricted: s.licenceRestricted,
      clips: rs.length,
      pooled: pooled(s.id),
      noteTruthDerived: derivedNoteTruth.has(s.id),
      pitchless: pitchlessIds.has(s.id),
      constructedPerformance: constructedIds.has(s.id),
      // MIREX COn — onset-only. Precision and recall reported separately because
      // for some onset corpora only one of them is meaningful (jacrc: syllable
      // onsets ⊂ note onsets, so read recall).
      onsetF1: mean(rs.map((r) => r.onsetOnly.f1)),
      onsetPrecision: mean(rs.map((r) => r.onsetOnly.precision)),
      onsetRecall: mean(rs.map((r) => r.onsetOnly.recall)),
      f1: mean(rs.map((r) => r.metrics.f1)),
      f1Off: mean(rs.map((r) => r.metrics.f1Off)),
      chromaF1: mean(rs.map((r) => r.metrics.chromaF1)),
      precision: mean(rs.map((r) => r.metrics.precision)),
      recall: mean(rs.map((r) => r.metrics.recall)),
      octaveErrorRate: mean(rs.map((r) => r.metrics.octaveErrorRate)),
      medianPitchErr: mean(rs.map((r) => r.metrics.medianPitchErr)),
      timing: timingStats(
        rs.flatMap((r) => r.metrics.timing.onsetDeltasMs),
        rs.flatMap((r) => r.metrics.timing.offsetDeltasMs),
      ),
      seg: sumSegErrors(rs),
      repairSecondsPer100: repairSecondsPer100(sumSegErrors(rs)),
      onsets: sumOnsetClasses(rs),
    };
  });

  // Per condition — the robustness axis.
  const perCondition: ConditionAggregate[] = conditions
    .map((c) => {
      const rs = results.filter((r) => r.condition === c.id && pooled(r.scenario));
      return {
        condition: c.id,
        label: c.label,
        clips: rs.length,
        f1: mean(rs.map((r) => r.metrics.f1)),
        f1Off: mean(rs.map((r) => r.metrics.f1Off)),
        precision: mean(rs.map((r) => r.metrics.precision)),
        recall: mean(rs.map((r) => r.metrics.recall)),
        octaveErrorRate: mean(rs.map((r) => r.metrics.octaveErrorRate)),
      };
    })
    .filter((c) => c.clips > 0);

  // Per material — what the product benchmark reads first. Dataset-mean over the
  // pooled datasets of that material, matching the headline's convention.
  const supersededIds = new Set(
    datasets
      .map((d) => d.derivedFrom?.split('/').pop())
      .filter((id): id is string => !!id && datasets.some((d) => d.id === id)),
  );
  const materials = [...new Set(perScenario.map((s) => s.material))].sort();
  const perMaterial: MaterialAggregate[] = materials.map((material) => {
    const ds = perScenario.filter((s) => s.material === material && s.clips > 0);
    let gated = ds.filter((s) => s.pooled);
    // No benchmark-grade dataset at all (humming, whistling today): fall back to
    // the context datasets that DO carry pitched truth, and say so. A dataset
    // whose truth was repaired into an `-aligned` sibling is skipped — its own
    // score-timed truth is known-wrong by construction and would only drag the
    // provisional number down.
    const provisional = gated.length === 0;
    if (provisional) gated = ds.filter((s) => !s.pitchless && !supersededIds.has(s.scenario));
    const gatedClips = results.filter((r) => gated.some((s) => s.scenario === r.scenario));
    return {
      material,
      provisional,
      datasets: gated.map((s) => s.scenario),
      clips: gatedClips.length,
      f1: mean(gated.map((s) => s.f1)),
      f1Off: mean(gated.map((s) => s.f1Off)),
      precision: mean(gated.map((s) => s.precision)),
      recall: mean(gated.map((s) => s.recall)),
      repairSecondsPer100: repairSecondsPer100(sumSegErrors(gatedClips)),
      contextDatasets: ds.filter((s) => !s.pooled && !gated.includes(s)).map((s) => s.scenario),
    };
  });

  const pooledResults = results.filter((r) => pooled(r.scenario));
  const pooledScenarios = perScenario.filter((s) => s.pooled && s.clips > 0);
  const excludedScenarios = perScenario.filter((s) => !s.pooled).map((s) => s.scenario);

  return {
    label: o.label,
    mode: o.adaptive ? (o.noHint ? 'adaptive-no-hint' : 'adaptive') : 'fixed',
    provider: o.adaptive ? 'registry' : o.providerName,
    config: o.adaptive ? { adaptive: true } : { ...o.pitchOptions, highpassHz: o.highpassHz },
    matchTol: o.matchOpts,
    overallF1: mean(pooledScenarios.map((s) => s.f1)),
    overallF1Off: mean(pooledScenarios.map((s) => s.f1Off)),
    notePooling: {
      includeUntrusted: o.includeUntrusted,
      derivedNoteTruth: [...derivedNoteTruth],
      pitchless: [...pitchlessIds],
      constructedPerformance: [...constructedIds],
      excludedFromOverall: excludedScenarios,
    },
    // Excluded datasets are dropped from the timing pool too: their onsets are
    // frame-grid quantized by the same derivation, so they would bias the bias.
    overallTiming: timingStats(
      pooledResults.flatMap((r) => r.metrics.timing.onsetDeltasMs),
      pooledResults.flatMap((r) => r.metrics.timing.offsetDeltasMs),
    ),
    perMaterial,
    perScenario,
    perCondition,
    segErrors: sumSegErrors(pooledResults),
    repairSecondsPer100: repairSecondsPer100(sumSegErrors(pooledResults)),
    onsetClasses: sumOnsetClasses(pooledResults),
    clips: results.map((r) => ({
      scenario: r.scenario,
      melody: r.melody,
      condition: r.condition,
      split: r.split,
      ...r.metrics,
      seg: r.seg,
      onsetOnly: r.onsetOnly,
    })),
  };
}
