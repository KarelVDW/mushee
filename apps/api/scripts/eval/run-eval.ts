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
 *   EVAL_INCLUDE_UNTRUSTED  pool datasets whose note truth is derived, not
 *                     annotated (`noteTruthDerived` in dataset.json), back into
 *                     the headline note-F1. Off by default — see below.
 *
 * Two scoring rules keep the headline number honest:
 *   - A clip carrying several independent annotations is scored against the one
 *     it matches best (`scoreNotesBest`): annotators disagree about ornament
 *     grouping, and charging the pipeline for that measures taste, not accuracy.
 *   - Datasets that ship no note events, only frame pitch we segmented
 *     ourselves, are reported per-dataset but excluded from the pooled
 *     aggregates: their labels come out of the same algorithm family as the
 *     segmenter under test, so a better segmenter would score worse.
 */

import { existsSync, readdirSync,readFileSync, writeFileSync } from 'fs';
import { join,resolve } from 'path';

import { AudioConverter } from '../../src/recordings/pipeline/audio-converter';
import { AudioDecoder } from '../../src/recordings/pipeline/audio-decoder';
import { ProfileResolver } from '../../src/recordings/pipeline/profiles/profile-resolver';
import { BasicPitchProvider } from '../../src/recordings/pipeline/providers/basic-pitch-provider';
import { CrepeProvider } from '../../src/recordings/pipeline/providers/crepe-provider';
import { LocalModelBackend } from '../../src/recordings/pipeline/providers/local-model-backend';
import type {
  PitchProvider,
  PitchTranscribeOptions,
} from '../../src/recordings/pipeline/providers/pitch-provider';
import { ProviderRegistry } from '../../src/recordings/pipeline/providers/provider-registry';
import {
  type EstNote,
  type MatchOptions,
  type Metrics,
  scoreNotesBest,
  scoreOnsets,
  timingStats,
} from './lib/metrics';
import {
  addOnsetClassStats,
  emptyOnsetClassStats,
  formatOnsetClasses,
  type OnsetClassStats,
  onsetRecallByClass,
} from './lib/onsetClasses';
import { discoverRealDatasets } from './lib/realCorpus';
import {
  formatSegErrors,
  repairSecondsPer100,
  type SegErrorCounts,
  segErrors,
} from './lib/segErrors';
import { CONDITIONS,SCENARIOS } from './scenarios';
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
  const backend = new LocalModelBackend({
    basicPitch: MODELS.basicPitch,
    crepeTiny: MODELS.crepeTiny,
  });
  switch (name) {
    case 'crepe-tiny':
      return new CrepeProvider(backend, 'crepe-tiny');
    case 'basic-pitch':
    default:
      return new BasicPitchProvider(backend);
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
 * recorded clips (nothing is synthesized), so it's zeroed. `dir` carries the
 * dataset's actual directory — since the benchmark/context tiering, datasets
 * live one level below the eval-real root, so `join(root, id)` no longer
 * resolves them.
 */
type EvalScenario = Scenario & { dir?: string };

function discoverRealScenarios(root: string): EvalScenario[] {
  return discoverRealDatasets(root).map((d) => ({
    id: d.id,
    label: d.label,
    kind: d.kind,
    instrumentId: d.instrumentId,
    rootMidi: 0,
    dir: d.dir,
  }));
}

// Real clips ship as `<clip>__real.wav`; the harness's per-condition WAV lookup
// reuses this pseudo-condition. Degraded variants of the real clips (see
// degrade-real.ts) reuse the synthetic condition ids — missing variants are
// simply skipped, so running before degrade-real.ts still works.
const REAL_CONDITION: Condition = { id: 'real', label: 'real recording' };

interface ClipResult {
  scenario: string;
  melody: string;
  condition: string;
  metrics: Metrics;
  /**
   * Molina split/merged/missed/spurious for this clip, and the onset taxonomy.
   *
   * Reported in the HEADLINE run, not only in `sweep-segmenter.ts`, because these
   * are the numbers the whole segmentation effort targets and F1 hides them: "12
   * notes for 8" and "6 notes for 8" can share an F1 and be very different
   * products (a missing note costs ~145 s of expert repair, a spurious one ~3.5 s).
   */
  seg: SegErrorCounts;
  onsets: OnsetClassStats;
  /**
   * MIREX COn (onset-only, pitch ignored) — computed for every clip, cheap,
   * and the only meaningful score for `pitchless` datasets (lib/realCorpus.ts),
   * whose truth carries no real MIDI. Reported alongside the pitch-aware
   * metrics for every other dataset too, as a secondary number.
   */
  onsetOnly: { precision: number; recall: number; f1: number };
}

function emptySegErrors(): SegErrorCounts {
  return {
    clean: 0, split: 0, merged: 0, missed: 0, spurious: 0,
    tangled: 0, pitchWrong: 0, refTotal: 0, estTotal: 0,
  };
}

function sumSegErrors(rs: ClipResult[]): SegErrorCounts {
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
    minFramesPerNote: numEnv('EVAL_MIN_FRAMES'),
    // WaoN's joint duration × velocity filters (basic-pitch only; R15).
    keepShortLoudRatio: numEnv('EVAL_KEEP_SHORT_LOUD'),
    dropLongQuiet:
      numEnv('EVAL_LQ_QUIET') !== undefined || numEnv('EVAL_LQ_MINSEC') !== undefined
        ? { quietRatio: numEnv('EVAL_LQ_QUIET'), minSec: numEnv('EVAL_LQ_MINSEC') }
        : undefined,
  };
  const highpassHz = numEnv('EVAL_HIGHPASS') ?? 80;
  const fixedDenoise = boolEnv('EVAL_DENOISE');
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
        // The corpus knows what each dataset is; in the app this is either the
        // client's declaration or (since the source classifier) the audio
        // itself. ALWAYS explicit here — including for instruments — so eval
        // numbers measure the pipeline, not the classifier's day. Suppressed
        // under EVAL_NO_HINT, which is also how to exercise the classifier
        // end-to-end over the corpus.
        sourceKind: noHint ? undefined : scenario.kind === 'voice' ? 'voice' : 'instrument',
      });
      const provider = registry.get(profile.providerName);
      const decoded = await decoder.decode(buf, provider.sampleRate, {
        loudnorm: provider.normalizeLoudness,
        highpassHz: profile.highpassHz,
        denoise: profile.denoise,
      });
      const extracted = await new AudioConverter(provider, {
        enableOnsetSplit: onsetSplit,
        profile,
      }).convert(decoded.samples, { bpm }, undefined, {
        minFreqHz: profile.minFreqHz,
        maxFreqHz: profile.maxFreqHz,
        confidenceThreshold: profile.confidenceThreshold,
        onsetThreshold: profile.onsetThreshold,
        frameThreshold: profile.frameThreshold,
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
  } else {
    const provider = buildProvider(providerName);
    await provider.init();
    transcribe = async (_scenario, buf, bpm) => {
      const decoded = await decoder.decode(buf, provider.sampleRate, {
        loudnorm: provider.normalizeLoudness,
        highpassHz,
        denoise: fixedDenoise,
      });
      const extracted = await new AudioConverter(provider, {
        enableOnsetSplit: onsetSplit,
      }).convert(decoded.samples, { bpm }, undefined, pitchOptions);
      return extracted.deduced.map((n) => ({
        onsetSec: n.startTimeSeconds,
        durSec: n.durationSeconds,
        midi: n.pitchMidi,
      }));
    };
  }

  // Datasets that declare `noteTruthDerived` still get run and reported, but
  // their note-F1 stays out of the pooled numbers unless explicitly asked for:
  // their "annotations" are a semitone-rounding-and-run-grouping derivation of
  // frame pitch, so a segmenter is scored against a sibling of itself.
  const derivedNoteTruth = new Set(
    realMode
      ? discoverRealDatasets(evalRoot)
          .filter((d) => d.noteTruthDerived)
          .map((d) => d.id)
      : [],
  );
  // `pitchless` datasets (lib/realCorpus.ts) ship no real MIDI at all (e.g.
  // AVP's vocal-percussion onsets): note-F1/chroma/octave-error and the
  // onset-class taxonomy are meaningless for them, on top of (not instead of)
  // the noteTruthDerived exclusion above.
  const pitchlessIds = new Set(
    realMode
      ? discoverRealDatasets(evalRoot)
          .filter((d) => d.pitchless)
          .map((d) => d.id)
      : [],
  );
  // `constructedPerformance` datasets (lib/realCorpus.ts) have exact truth over
  // real timbre, but the phrasing is ours — spliced isolated notes. Excluded for
  // the opposite reason to the two above: not because the labels are weak, but
  // because a constructed performance in the pooled mean would make the headline
  // easier without the pipeline changing.
  const constructedIds = new Set(
    realMode
      ? discoverRealDatasets(evalRoot)
          .filter((d) => d.constructedPerformance)
          .map((d) => d.id)
      : [],
  );
  const includeUntrusted = boolEnv('EVAL_INCLUDE_UNTRUSTED');
  const pooled = (scenarioId: string): boolean =>
    includeUntrusted ||
    (!derivedNoteTruth.has(scenarioId) &&
      !pitchlessIds.has(scenarioId) &&
      !constructedIds.has(scenarioId));

  const allScenarios: EvalScenario[] = realMode
    ? discoverRealScenarios(evalRoot)
    : SCENARIOS;
  const scenarios = allScenarios.filter(
    (s) => !scenarioFilter || scenarioFilter.includes(s.id),
  );
  const allConditions = realMode
    ? [REAL_CONDITION, ...CONDITIONS.filter((c) => c.id !== 'clean')]
    : CONDITIONS;
  const conditions = allConditions.filter(
    (c) => !conditionFilter || conditionFilter.includes(c.id),
  );

  const results: ClipResult[] = [];

  for (const scenario of scenarios) {
    const dir = scenario.dir ?? join(evalRoot, scenario.id);
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
          metrics: scoreNotesBest(truth, est, matchOpts),
          seg: segErrors(truth.notes, est),
          onsets: onsetRecallByClass(truth.notes, est, matchOpts.onsetTolSec),
          onsetOnly: scoreOnsets(truth.notes, est, matchOpts.onsetTolSec),
        });
      }
    }
    // Per-scenario line as we go (long runs).
    const sc = results.filter((r) => r.scenario === scenario.id);
    const f1 = mean(sc.map((r) => r.metrics.f1));
    const oct = mean(sc.map((r) => r.metrics.octaveErrorRate));
    console.log(
      `  ${scenario.id.padEnd(18)} COnP@0.1=${f1.toFixed(2)}  octErr=${oct.toFixed(2)}  (${sc.length} clips)`,
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
      /** False = reported for information only, kept out of the aggregates. */
      pooled: pooled(s.id),
      noteTruthDerived: derivedNoteTruth.has(s.id),
      pitchless: pitchlessIds.has(s.id),
      constructedPerformance: constructedIds.has(s.id),
      // MIREX COn — onset-only, pitch ignored. The headline number for
      // `pitchless` datasets; a secondary number for everyone else. Precision
      // and recall are reported separately because for some onset corpora only
      // one of them is meaningful: where the truth marks SYLLABLE onsets on
      // melismatic singing (jacrc), a note onset inside a melisma is a correct
      // detection that the truth does not list, so precision is understated by
      // construction and recall is the number to read.
      onsetF1: mean(rs.map((r) => r.onsetOnly.f1)),
      onsetPrecision: mean(rs.map((r) => r.onsetOnly.precision)),
      onsetRecall: mean(rs.map((r) => r.onsetOnly.recall)),
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
      seg: sumSegErrors(rs),
      repairSecondsPer100: repairSecondsPer100(sumSegErrors(rs)),
      onsets: sumOnsetClasses(rs),
    };
  });

  // Aggregate per condition — the robustness axis: how much each acoustic
  // circumstance costs relative to clean.
  const perCondition = conditions
    .map((c) => {
      const rs = results.filter(
        (r) => r.condition === c.id && pooled(r.scenario),
      );
      return {
        condition: c.id,
        label: c.label,
        clips: rs.length,
        f1: mean(rs.map((r) => r.metrics.f1)),
        precision: mean(rs.map((r) => r.metrics.precision)),
        recall: mean(rs.map((r) => r.metrics.recall)),
        octaveErrorRate: mean(rs.map((r) => r.metrics.octaveErrorRate)),
      };
    })
    .filter((c) => c.clips > 0);

  // Excluded datasets are dropped from the timing pool too: their onsets are
  // frame-grid quantized by the same derivation, so they would bias the bias.
  const pooledResults = results.filter((r) => pooled(r.scenario));
  const overallTiming = timingStats(
    pooledResults.flatMap((r) => r.metrics.timing.onsetDeltasMs),
    pooledResults.flatMap((r) => r.metrics.timing.offsetDeltasMs),
  );
  const overallF1 = mean(perScenario.filter((s) => s.pooled).map((s) => s.f1));
  const excludedScenarios = perScenario
    .filter((s) => !s.pooled)
    .map((s) => s.scenario);
  const report = {
    label,
    mode: adaptive ? (noHint ? 'adaptive-no-hint' : 'adaptive') : 'fixed',
    provider: adaptive ? 'registry' : providerName,
    config: adaptive ? { adaptive: true } : { ...pitchOptions, highpassHz },
    matchTol: matchOpts,
    overallF1,
    /** What the headline F1 does and does not average over. */
    notePooling: {
      includeUntrusted,
      derivedNoteTruth: [...derivedNoteTruth],
      pitchless: [...pitchlessIds],
      constructedPerformance: [...constructedIds],
      excludedFromOverall: excludedScenarios,
    },
    overallTiming,
    perScenario,
    perCondition,
    segErrors: sumSegErrors(pooledResults),
    repairSecondsPer100: repairSecondsPer100(sumSegErrors(pooledResults)),
    onsetClasses: sumOnsetClasses(pooledResults),
    clips: results.map((r) => ({
      scenario: r.scenario,
      melody: r.melody,
      condition: r.condition,
      ...r.metrics,
      seg: r.seg,
      onsetOnly: r.onsetOnly,
    })),
  };
  writeFileSync(outPath, JSON.stringify(report, null, 2));

  console.log(`\n=== ${label} (${report.mode}) ===`);
  console.log(
    'scenario'.padEnd(20) +
      'COnP'.padEnd(7) +
      'chromaF1'.padEnd(10) +
      'octErr'.padEnd(8) +
      'COn'.padEnd(6) +
      'COnRec'.padEnd(9),
  );
  for (const s of perScenario) {
    console.log(
      s.scenario.padEnd(20) +
        s.f1.toFixed(2).padEnd(7) +
        s.chromaF1.toFixed(2).padEnd(10) +
        s.octaveErrorRate.toFixed(2).padEnd(8) +
        s.onsetF1.toFixed(2).padEnd(6) +
        s.onsetRecall.toFixed(2).padEnd(9) +
        (s.pooled
          ? ''
          : s.pitchless
            ? '† not pooled (pitchless — read COn(onset) instead)'
            : s.constructedPerformance
              ? '† not pooled (constructed performance — real timbre, spliced notes)'
              : '† not pooled (note truth derived)'),
    );
  }
  console.log('\n' + 'condition'.padEnd(20) + 'COnP'.padEnd(7) + 'prec'.padEnd(7) + 'recall'.padEnd(8) + 'octErr');
  for (const c of perCondition) {
    console.log(
      c.condition.padEnd(20) +
        c.f1.toFixed(2).padEnd(7) +
        c.precision.toFixed(2).padEnd(7) +
        c.recall.toFixed(2).padEnd(8) +
        c.octaveErrorRate.toFixed(2),
    );
  }

  console.log(
    `\nOVERALL mean COnP@0.1 (onset+pitch, no offset gate) = ${overallF1.toFixed(3)}` +
      ` (${perScenario.filter((s) => s.pooled).length} datasets)`,
  );
  if (excludedScenarios.length) {
    console.log(
      `† excluded from the aggregates: ${excludedScenarios.join(', ')}. ` +
        // Two different reasons, and conflating them misreads the numbers: a
        // derived-truth dataset HAS pitch we should not trust, a pitchless one
        // has no pitch at all, so its COnP is meaningless rather than merely
        // unreliable and only the COn/COnRec columns say anything.
        [
          excludedScenarios.filter((s) => derivedNoteTruth.has(s)).length
            ? `Note truth derived, not annotated (${excludedScenarios
                .filter((s) => derivedNoteTruth.has(s))
                .join(', ')}) — our own derivation of the corpus's frame pitch.`
            : '',
          excludedScenarios.filter((s) => constructedIds.has(s)).length
            ? `Constructed performance (${excludedScenarios
                .filter((s) => constructedIds.has(s))
                .join(', ')}) — real recorded timbre, but the notes were spliced ` +
              'by us, so the truth is exact and the phrasing is not human.'
            : '',
          excludedScenarios.filter((s) => pitchlessIds.has(s)).length
            ? `Pitchless (${excludedScenarios
                .filter((s) => pitchlessIds.has(s))
                .join(', ')}) — onset-only truth, so COnP/chromaF1/octErr are ` +
              'meaningless for them; read the COn and COnRec columns.'
            : '',
        ]
          .filter(Boolean)
          .join(' ') +
        ' EVAL_INCLUDE_UNTRUSTED=1 pools them anyway.',
    );
  }

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
  // Segmentation breakdown: HOW each dataset is wrong. Read `missed` first — a
  // missing note costs ~145 s of expert time to restore against ~3.5 s to delete a
  // spurious one, so two datasets with equal F1 are not equally good products.
  console.log('\n--- segmentation errors, per 100 reference notes ---');
  for (const s of perScenario) {
    if (!s.clips) continue;
    console.log(`${s.scenario.padEnd(20)} ${formatSegErrors(s.seg)}`);
  }
  const pooledSeg = sumSegErrors(pooledResults);
  console.log(`${'POOLED'.padEnd(20)} ${formatSegErrors(pooledSeg)}`);

  // Onset taxonomy (Yong et al.): a re-onset is a same-pitch re-articulation ≤20 ms
  // after the previous note ends. A pitch-trajectory decode cannot see one at all,
  // so this column is the only place a boundary-channel change proves itself.
  console.log(
    '\n--- onset recall by class (re-onset = same pitch, ≤20 ms gap) ---',
  );
  for (const s of perScenario) {
    if (!s.clips) continue;
    console.log(`${s.scenario.padEnd(20)} ${formatOnsetClasses(s.onsets)}`);
  }
  console.log(`${'POOLED'.padEnd(20)} ${formatOnsetClasses(sumOnsetClasses(pooledResults))}`);

  console.log(`\nReport written to ${outPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
