/**
 * Run the audio→notes pipeline over a corpus and score each clip against its
 * ground truth. The everyday tuning entry point; the scorer itself lives in
 * `lib/evalRun.ts` (shared with `benchmark.ts`, the committed product benchmark).
 *
 * Config is read from env so a sweep can run without editing files. With no
 * overrides this measures the pipeline's current defaults (the baseline):
 *
 *   tsx scripts/eval/run-eval.ts                       # synthetic corpus, fixed crepe-tiny
 *   EVAL_REAL=1 EVAL_ADAPTIVE=1 tsx scripts/eval/run-eval.ts   # the production path, real corpus
 *   EVAL_PROVIDER=crepe-tiny-down1 EVAL_MAX_FREQ=4000 \
 *   EVAL_SCENARIOS=whistle-high,whistle-mid tsx scripts/eval/run-eval.ts
 *
 * Env:
 *   EVAL_REAL         1 = the real recorded corpus (fixtures/eval-real), else synthetic
 *   EVAL_ADAPTIVE     1 = the production resolver + registry; else a fixed config:
 *   EVAL_PROVIDER     crepe-tiny | crepe-tiny-down1  (default crepe-tiny)
 *   EVAL_MIN_FREQ, EVAL_MAX_FREQ, EVAL_CONFIDENCE, EVAL_MIN_FRAMES, EVAL_HIGHPASS, EVAL_DENOISE
 *   EVAL_SCENARIOS, EVAL_CONDITIONS  comma-separated id filters
 *   EVAL_NO_HINT      1 = strip the instrument hint and sourceKind (exercises the classifier)
 *   EVAL_NO_ONSET_SPLIT  1 = disable the re-attack splitter (A/B)
 *   EVAL_ONSET_TOL / EVAL_TIMING_TOL   match window (0.1 s) / timing diagnostic window (0.3 s)
 *   EVAL_OUT          report path (default <corpus root>/report.json)
 *   EVAL_LABEL        label stored in the report (e.g. the config name)
 *   EVAL_INCLUDE_UNTRUSTED  pool derived / pitchless / constructed datasets into the headline
 */

import { writeFileSync } from 'fs';
import { join } from 'path';

import type { PitchTranscribeOptions } from '../../src/recordings/pipeline/providers/pitch-provider';
import {
  defaultEvalOptions,
  type EvalReport,
  REAL_ROOT,
  runEval,
  SYNTH_ROOT,
} from './lib/evalRun';
import { formatOnsetClasses } from './lib/onsetClasses';
import { formatSegErrors } from './lib/segErrors';

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

/** The console rendering of a report — shared with benchmark.ts's `run`. */
export function printReport(report: EvalReport): void {
  console.log(`\n=== ${report.label} (${report.mode}) ===`);
  console.log(
    'dataset'.padEnd(30) + 'COnP'.padEnd(7) + 'COnPOff'.padEnd(9) + 'chromaF1'.padEnd(10) +
      'octErr'.padEnd(8) + 'COn'.padEnd(6) + 'COnRec'.padEnd(9),
  );
  for (const s of report.perScenario) {
    if (!s.clips) continue;
    console.log(
      s.scenario.padEnd(30) + s.f1.toFixed(2).padEnd(7) + s.f1Off.toFixed(2).padEnd(9) +
        s.chromaF1.toFixed(2).padEnd(10) + s.octaveErrorRate.toFixed(2).padEnd(8) +
        s.onsetF1.toFixed(2).padEnd(6) + s.onsetRecall.toFixed(2).padEnd(9) +
        (s.pooled
          ? ''
          : s.pitchless
            ? '† not pooled (pitchless — read COn(onset) instead)'
            : s.constructedPerformance
              ? '† not pooled (constructed performance — real timbre, spliced notes)'
              : '† not pooled (note truth derived)'),
    );
  }

  console.log('\n' + 'material'.padEnd(20) + 'COnP'.padEnd(7) + 'COnPOff'.padEnd(9) + 'prec'.padEnd(7) + 'recall'.padEnd(8) + 'datasets');
  for (const m of report.perMaterial) {
    console.log(
      m.material.padEnd(20) + m.f1.toFixed(3).padEnd(7) + m.f1Off.toFixed(3).padEnd(9) +
        m.precision.toFixed(2).padEnd(7) + m.recall.toFixed(2).padEnd(8) +
        (m.provisional
          ? m.datasets.length
            ? `PROVISIONAL — no benchmark-grade data; ${m.datasets.length} context dataset(s): ${m.datasets.join(', ')}`
            : 'NO DATA with pitched truth'
          : `${m.datasets.length} pooled`) +
        (m.contextDatasets.length ? ` (+${m.contextDatasets.length} context-only)` : ''),
    );
  }

  console.log('\n' + 'condition'.padEnd(20) + 'COnP'.padEnd(7) + 'COnPOff'.padEnd(9) + 'prec'.padEnd(7) + 'recall'.padEnd(8) + 'octErr');
  for (const c of report.perCondition) {
    console.log(
      c.condition.padEnd(20) + c.f1.toFixed(2).padEnd(7) + c.f1Off.toFixed(2).padEnd(9) +
        c.precision.toFixed(2).padEnd(7) + c.recall.toFixed(2).padEnd(8) + c.octaveErrorRate.toFixed(2),
    );
  }

  const pooledCount = report.perScenario.filter((s) => s.pooled && s.clips > 0).length;
  console.log(
    `\nOVERALL mean COnP@0.1 (onset+pitch, no offset gate) = ${report.overallF1.toFixed(3)}` +
      ` (${pooledCount} datasets); COnPOff = ${report.overallF1Off.toFixed(3)}`,
  );
  const ex = report.notePooling;
  if (ex.excludedFromOverall.length) {
    const derived = ex.excludedFromOverall.filter((s) => ex.derivedNoteTruth.includes(s));
    const constructed = ex.excludedFromOverall.filter((s) => ex.constructedPerformance.includes(s));
    const pitchless = ex.excludedFromOverall.filter((s) => ex.pitchless.includes(s));
    console.log(
      `† excluded from the aggregates: ${ex.excludedFromOverall.join(', ')}. ` +
        [
          derived.length
            ? `Note truth derived, not annotated (${derived.join(', ')}) — our own derivation of the corpus's frame pitch.`
            : '',
          constructed.length
            ? `Constructed performance (${constructed.join(', ')}) — real recorded timbre, but the notes were spliced by us.`
            : '',
          pitchless.length
            ? `Pitchless (${pitchless.join(', ')}) — onset-only truth; read the COn and COnRec columns.`
            : '',
        ]
          .filter(Boolean)
          .join(' ') +
        ' EVAL_INCLUDE_UNTRUSTED=1 pools them anyway.',
    );
  }

  // Timing diagnostic (signed ms over exact-pitch matches; + = pipeline late).
  const tol = report.matchTol.timingTolSec * 1000;
  console.log(`\n--- onset timing (signed ms, + = late, window ±${tol.toFixed(0)}ms) ---`);
  console.log('dataset'.padEnd(30) + 'bias'.padEnd(8) + 'median'.padEnd(8) + 'std'.padEnd(8) + 'mae'.padEnd(8) + 'offBias'.padEnd(9) + 'n');
  for (const s of report.perScenario) {
    if (!s.clips) continue;
    const t = s.timing;
    console.log(
      s.scenario.padEnd(30) + t.onsetBiasMs.toFixed(0).padEnd(8) + t.onsetMedianMs.toFixed(0).padEnd(8) +
        t.onsetStdMs.toFixed(0).padEnd(8) + t.onsetMaeMs.toFixed(0).padEnd(8) +
        t.offsetBiasMs.toFixed(0).padEnd(9) + String(t.matched),
    );
  }
  const ot = report.overallTiming;
  console.log(
    `\nOVERALL onset bias=${ot.onsetBiasMs.toFixed(1)}ms median=${ot.onsetMedianMs.toFixed(1)}ms ` +
      `std=${ot.onsetStdMs.toFixed(1)}ms mae=${ot.onsetMaeMs.toFixed(1)}ms ` +
      `offsetBias=${ot.offsetBiasMs.toFixed(1)}ms (n=${ot.matched})`,
  );

  // Segmentation breakdown: HOW each dataset is wrong. Read `missed` first — a
  // missing note costs ~145 s of expert time to restore against ~3.5 s to delete
  // a spurious one, so two datasets with equal F1 are not equally good products.
  console.log('\n--- segmentation errors, per 100 reference notes ---');
  for (const s of report.perScenario) {
    if (!s.clips) continue;
    console.log(`${s.scenario.padEnd(30)} ${formatSegErrors(s.seg)}`);
  }
  console.log(`${'POOLED'.padEnd(30)} ${formatSegErrors(report.segErrors)}`);

  console.log('\n--- onset recall by class (re-onset = same pitch, ≤20 ms gap) ---');
  for (const s of report.perScenario) {
    if (!s.clips) continue;
    console.log(`${s.scenario.padEnd(30)} ${formatOnsetClasses(s.onsets)}`);
  }
  console.log(`${'POOLED'.padEnd(30)} ${formatOnsetClasses(report.onsetClasses)}`);
}

async function main(): Promise<void> {
  const adaptive = boolEnv('EVAL_ADAPTIVE');
  const real = boolEnv('EVAL_REAL');
  const providerName = process.env.EVAL_PROVIDER ?? 'crepe-tiny';
  const pitchOptions: PitchTranscribeOptions = {
    minFreqHz: numEnv('EVAL_MIN_FREQ'),
    maxFreqHz: numEnv('EVAL_MAX_FREQ'),
    confidenceThreshold: numEnv('EVAL_CONFIDENCE'),
    minFramesPerNote: numEnv('EVAL_MIN_FRAMES'),
  };
  const outPath = process.env.EVAL_OUT ?? join(real ? REAL_ROOT : SYNTH_ROOT, 'report.json');

  const report = await runEval(
    defaultEvalOptions({
      real,
      adaptive,
      providerName,
      pitchOptions,
      highpassHz: numEnv('EVAL_HIGHPASS') ?? 80,
      fixedDenoise: boolEnv('EVAL_DENOISE'),
      scenarioFilter: listEnv('EVAL_SCENARIOS'),
      conditionFilter: listEnv('EVAL_CONDITIONS'),
      noHint: boolEnv('EVAL_NO_HINT'),
      onsetSplit: !boolEnv('EVAL_NO_ONSET_SPLIT'),
      label: process.env.EVAL_LABEL ?? (adaptive ? 'adaptive' : providerName),
      matchOpts: {
        onsetTolSec: numEnv('EVAL_ONSET_TOL') ?? 0.1,
        timingTolSec: numEnv('EVAL_TIMING_TOL') ?? 0.3,
      },
      includeUntrusted: boolEnv('EVAL_INCLUDE_UNTRUSTED'),
      onProgress: (line) => console.log(line),
    }),
  );
  writeFileSync(outPath, JSON.stringify(report, null, 2));
  printReport(report);
  console.log(`\nReport written to ${outPath}`);
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
