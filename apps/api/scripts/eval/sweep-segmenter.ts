/**
 * Sweep note-segmentation configs over the cached real corpus.
 *
 * Segmentation is the stage that decides where notes begin and end, and the
 * ablation showed it is where the corpus loses most of its accuracy: on studio
 * singing the current segmenter emits ~18 notes for ~8 sung (vibrato flutter),
 * while the downstream cleanup that fixes THAT costs ~0.10 F1 on hummed queries
 * by merging real notes away. This script exists to find a configuration that is
 * good on both, rather than trading one for the other.
 *
 * Everything runs off the `TrackCache`, so a full sweep is seconds — the model
 * forward pass is never repeated.
 *
 * Columns are reported PER DATASET plus a `mean` column, because a config that
 * lifts the average by wrecking one dataset is not an improvement. `worst` is the
 * lowest per-dataset F1, the number to maximise if we care about not being
 * embarrassing on any input.
 *
 * Run: pnpm --filter @mushee/api exec tsx scripts/eval/sweep-segmenter.ts
 * Env: EVAL_SPLIT=dev|test|all  (default dev — tune here, confirm on test)
 *      SWEEP_STAGE=seg|clean|quant  which stage's output to score (default clean)
 *      SWEEP_ONLY=substr            run only configs whose name contains substr
 *      SWEEP_BASELINE=name          config the paired comparison is against
 *                                   (default the shipping segmenter)
 *      SWEEP_EXCLUDE=ds1,ds2        datasets to drop from the mean AND the paired
 *                                   comparison. Use for corpora whose labels are
 *                                   not trustworthy — mir-qbsh's note events are
 *                                   manufactured by the harness from frame pitch
 *                                   (see the README findings log), so gating on it rewards
 *                                   reproducing that artefact.
 */

import { resolve } from 'path';

import { NoteExtractor, type NoteExtractorOptions } from '../../src/recordings/pipeline/note-extractor';
import { NoteSegmenter, type NoteSegmenterOptions } from '../../src/recordings/pipeline/note-segmenter';
import { segmentNotes } from '../../src/recordings/pipeline/providers/pitch-decoder';
import { ProviderRegistry } from '../../src/recordings/pipeline/providers/provider-registry';
import { type EstNote, scoreNotesBest } from './lib/metrics';
import { discoverRealDatasets, listRealClips } from './lib/realCorpus';
import {
  formatSegErrors,
  repairSecondsPer100,
  type SegErrorCounts,
  segErrors,
} from './lib/segErrors';
import { inSplit, splitFromEnv } from './lib/split';
import { formatComparison, pairedDiffCI } from './lib/stats';
import { type CachedClip, TrackCache } from './lib/trackCache';
import type { GroundTruth } from './types';

const REAL_ROOT = resolve(__dirname, '../fixtures/eval-real');
const CACHE_ROOT = resolve(__dirname, '../fixtures/eval-cache');
const MODELS = {
  basicPitch: resolve(process.cwd(), 'model'),
  crepeTiny: resolve(process.cwd(), 'model-crepe-tiny'),
};

type Stage = 'seg' | 'clean' | 'quant';

interface Config {
  name: string;
  /** Legacy-segmenter gate overrides (note-length floor / smoother width). */
  legacyOver?: { minFrames?: number; smoothFrames?: number };
  /**
   * Replace the dip-then-rise onset splitter's onsets with pYIN's amplitude-ratio
   * rule at this sensitivity: onset at frame i-1 wherever energy[i+1]/energy[i-1]
   * exceeds 1/s. pYIN marks the frame unvoiced (splits, never creates), which maps
   * onto our mechanism as an extra split point handed to `splitAtOnsets`.
   */
  ratioSplitSens?: number;
  /** Legacy semitone-run segmenter (the shipping one) instead of the HMM. */
  legacy?: boolean;
  seg?: NoteSegmenterOptions;
  ext?: NoteExtractorOptions;
  /** Skip NoteExtractor.clean entirely — the HMM may not need it. */
  noClean?: boolean;
}

function mean(xs: number[]): number {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
}

function toEst(
  notes: { startTimeSeconds: number; durationSeconds: number; pitchMidi: number }[],
): EstNote[] {
  return notes.map((n) => ({
    onsetSec: n.startTimeSeconds,
    durSec: n.durationSeconds,
    midi: n.pitchMidi,
  }));
}

/** The shipping segmenter, driven off a cached track. */
function legacySegment(c: CachedClip, over: { minFrames?: number; smoothFrames?: number } = {}) {
  return segmentNotes(c.track.cents, c.track.confidence, c.track.frames, {
    hopSize: 1,
    sampleRate: 1 / c.track.hopSec,
    confidenceThreshold: c.profile.confidenceThreshold ?? 0.5,
    minFreqHz: c.profile.minFreqHz,
    maxFreqHz: c.profile.maxFreqHz,
    minFramesPerNote: over.minFrames ?? c.profile.minFramesPerNote ?? 4,
    pitchBinToleranceCents: 50,
    mode: 'semitone',
    smoothFrames: over.smoothFrames ?? 4,
  });
}

/**
 * pYIN's onset rule over the cached RMS envelope: an onset wherever the energy two
 * frames apart rises by more than a factor 1/s (their `1/r < s` with
 * r = a[i+1]/a[i-1]), placed at the trough frame, with the same 90 ms minimum
 * inter-onset interval the shipping detector uses so the comparison isolates the
 * DETECTION rule rather than the spacing policy.
 */
function ratioOnsets(energy: Float32Array, hopSec: number, s: number): number[] {
  const out: number[] = [];
  const minGap = Math.max(1, Math.round(0.09 / hopSec));
  let last = -minGap;
  // Ignore near-silence so the ratio can't fire on noise-floor flicker.
  let peak = 0;
  for (let i = 0; i < energy.length; i += 1) peak = Math.max(peak, energy[i]);
  const floor = peak * 0.08;
  for (let i = 1; i < energy.length - 1; i += 1) {
    const prev = energy[i - 1];
    if (energy[i + 1] < floor) continue;
    if (prev > 0 && prev / energy[i + 1] < s && i - last >= minGap) {
      out.push((i - 1) * hopSec);
      last = i;
    }
  }
  return out;
}

interface Acc {
  f1: Record<string, number[]>;
  /**
   * Recall-weighted F (β=2) at ±0.1 s. Reported alongside F1 because the symmetric
   * F1 misprices this problem: measured expert-correction time is ~3.5 s to delete
   * a spurious note but ~145 s to create a missing one, so a missed note is worth
   * roughly forty spurious ones. F2 is the metric that reflects that.
   */
  f2: number[];
  estN: number[];
  refN: number[];
}
const newAcc = (): Acc => ({
  f1: { '0.05': [], '0.1': [], '0.2': [] },
  f2: [],
  estN: [],
  refN: [],
});

function record(acc: Acc, truth: GroundTruth, est: EstNote[]): void {
  // Best-of-annotators, matching run-eval: where a clip carries independent
  // alternate annotations (vocadito), disagreement between them is stylistic and
  // an estimate is scored against whichever it matches better.
  for (const tol of ['0.05', '0.1', '0.2']) {
    acc.f1[tol].push(
      scoreNotesBest(truth, est, { onsetTolSec: Number(tol), timingTolSec: 0.3 }).f1,
    );
  }
  const m = scoreNotesBest(truth, est, { onsetTolSec: 0.1, timingTolSec: 0.3 });
  const denom = 4 * m.precision + m.recall;
  acc.f2.push(denom > 0 ? (5 * m.precision * m.recall) / denom : 0);
  acc.estN.push(est.length);
  acc.refN.push(m.refCount);
}

async function main(): Promise<void> {
  const registry = new ProviderRegistry(MODELS);
  await registry.initAll();
  const cache = new TrackCache(registry, CACHE_ROOT);
  const split = splitFromEnv();
  const stage = (process.env.SWEEP_STAGE as Stage) ?? 'clean';
  const only = process.env.SWEEP_ONLY;
  const baselineName = process.env.SWEEP_BASELINE ?? 'LEGACY (shipping)';
  // Excluded BY DEFAULT (previously every caller had to remember to pass them):
  //  - datasets whose note truth our own fetcher manufactured (`noteTruthDerived`)
  //    — gating on those rewards reproducing the derivation artefact;
  //  - held-out halves of a source corpus's own split (`corpusSplit: 'test'`) —
  //    they exist solely as external yardsticks, and sweeping against one
  //    destroys its only purpose.
  // Setting SWEEP_EXCLUDE (even to '') replaces the default entirely.
  const excluded = new Set(
    process.env.SWEEP_EXCLUDE !== undefined
      ? process.env.SWEEP_EXCLUDE.split(',').map((x) => x.trim()).filter(Boolean)
      : discoverRealDatasets(REAL_ROOT)
          .filter((d) => d.noteTruthDerived || d.corpusSplit === 'test')
          .map((d) => d.id),
  );

  // The HMM's note-change cost is the dominant knob; gammaCents (vibrato
  // tolerance) and minFrames interact with it. Sweep those, and keep the shipping
  // segmenter in the table as the thing to beat.
  const configs: Config[] = [{ name: 'LEGACY (shipping)', legacy: true, ext: { maxGridDivisor: 4 } }];
  configs.push({ name: 'LEGACY no-clean', legacy: true, noClean: true, ext: { maxGridDivisor: 4 } });
  // changeCost is the dominant knob; `trust` scales how loudly the per-frame pitch
  // argues against it, so the two have to be swept together.
  for (const changeCost of [0.1, 0.2, 0.4, 0.8, 3]) {
    for (const trust of [0.3, 1, 3]) {
      configs.push({
        name: `hmm c${changeCost} t${trust}`,
        seg: { changeCost, trust },
        ext: { maxGridDivisor: 4 },
        noClean: true,
      });
    }
  }
  // Note-length floor. Ours is 4 frames = 80 ms; pYIN (~100 ms), basic-pitch
  // (127.7 ms) and NeuralNote (125 ms default) all sit higher, and a floor is the
  // cheapest defence against vibrato fragments. Swept with the shipped cleanup.
  for (const minFrames of [3, 5, 6, 7]) {
    configs.push({
      name: `floor ${minFrames}f=${minFrames * 20}ms`,
      legacy: true,
      legacyOver: { minFrames },
      ext: { maxGridDivisor: 4, steps: { pitchOutliers: false, merge: false } },
    });
  }
  // Median-smoother width on the semitone track — the other lever against flutter.
  for (const smoothFrames of [2, 6, 8]) {
    configs.push({
      name: `smooth ${smoothFrames}`,
      legacy: true,
      legacyOver: { smoothFrames },
      ext: { maxGridDivisor: 4, steps: { pitchOutliers: false, merge: false } },
    });
  }
  // The shipped configuration, as the reference point for the two sweeps above.
  configs.push({
    name: 'SHIPPED',
    legacy: true,
    ext: { maxGridDivisor: 4, steps: { pitchOutliers: false, merge: false } },
  });
  // pYIN's amplitude-RATIO onset splitter (r = a[i+1]/a[i-1]; an onset wherever
  // the envelope rises by more than 1/s), the untested half of the literature
  // recommendation that took COnPOff 0.38→0.50 for Tony. Computed from the cached
  // per-frame energy, replacing the shipping dip-then-rise detector's onsets.
  for (const sens of [0.6, 0.7, 0.8]) {
    configs.push({
      name: `ratioSplit s=${sens}`,
      legacy: true,
      ext: { maxGridDivisor: 4, steps: { pitchOutliers: false, merge: false }, adaptiveFloorFraction: 0.3 },
      ratioSplitSens: sens,
    });
  }
  // The two knobs designed FOR the remaining failure (vibrato shattering sustained
  // notes on annotated-vocalset, still 1.61x over-segmented) and never validated
  // with an interval. `vibratoMaxSec` folds an A-B-A flutter back into one note;
  // `adaptiveFloorFraction` scales the fragment floor to the clip's own note
  // density and currently ships DISABLED.
  for (const vibratoMaxSec of [0, 0.25, 0.35]) {
    configs.push({
      name: `vibrato ${vibratoMaxSec}s`,
      legacy: true,
      ext: {
        maxGridDivisor: 4,
        vibratoMaxSec,
        steps: { pitchOutliers: false, merge: false },
      },
    });
  }
  for (const adaptiveFloorFraction of [0.3, 0.4, 0.5]) {
    configs.push({
      name: `adaptFloor ${adaptiveFloorFraction}`,
      legacy: true,
      ext: {
        maxGridDivisor: 4,
        adaptiveFloorFraction,
        steps: { pitchOutliers: false, merge: false },
      },
    });
  }
  // Both together, at their best-guess settings.
  configs.push({
    name: 'vibrato.35+floor.4',
    legacy: true,
    ext: {
      maxGridDivisor: 4,
      vibratoMaxSec: 0.35,
      adaptiveFloorFraction: 0.4,
      steps: { pitchOutliers: false, merge: false },
    },
  });
  // Which cleanup steps earn their keep? `clean` as a whole measures net-NEGATIVE
  // on the real corpus, so at least one of these five is harmful; each row below
  // disables exactly one, so a row scoring ABOVE 'LEGACY (shipping)' indicts that
  // step. Legacy segmenter throughout, so only the cleanup varies.
  const STEP_NAMES = ['monophonic', 'pitchOutliers', 'transients', 'merge', 'onsetSplit'] as const;
  for (const off of STEP_NAMES) {
    configs.push({
      name: `no-${off}`,
      legacy: true,
      ext: { maxGridDivisor: 4, steps: { [off]: false } },
    });
  }
  // The two indicted steps dropped together, which is the candidate default.
  configs.push({
    name: 'no-outliers+merge',
    legacy: true,
    ext: { maxGridDivisor: 4, steps: { pitchOutliers: false, merge: false } },
  });
  configs.push({
    name: 'onsetSplit-only',
    legacy: true,
    ext: {
      maxGridDivisor: 4,
      steps: { pitchOutliers: false, merge: false, transients: false, monophonic: false },
    },
  });
  // Does the wide-attack state actually earn its keep? (σ_attack = σ_stable ⇒ off.)
  for (const changeCost of [0.8, 1.2, 2]) {
    configs.push({
      name: `hmm c${changeCost} flat-σ`,
      seg: { changeCost, sigmaAttackSemitones: 0.9 },
      ext: { maxGridDivisor: 4 },
      noClean: true,
    });
  }
  // Semitone-only states, to isolate what sub-semitone resolution buys.
  configs.push({
    name: 'hmm c1.2 1step',
    seg: { changeCost: 1.2, stepsPerSemitone: 1 },
    ext: { maxGridDivisor: 4 },
    noClean: true,
  });
  // Best-guess region with the cleanup back on, to see whether it still helps.
  for (const changeCost of [0.8, 1.2, 2]) {
    configs.push({
      name: `hmm c${changeCost} +clean`,
      seg: { changeCost },
      ext: { maxGridDivisor: 4 },
    });
  }

  const selected = configs.filter((c) => !only || c.name.includes(only));
  const datasets = discoverRealDatasets(REAL_ROOT);

  // Load every clip once, up front, so config loops touch only arithmetic.
  const clips: CachedClip[] = [];
  for (const ds of datasets) {
    for (const clip of listRealClips(ds.dir)) {
      if (excluded.has(ds.id)) continue;
      if (!inSplit(ds.id, clip, split)) continue;
      let c: CachedClip | null = null;
      try {
        c = await cache.load(ds, clip);
      } catch {
        c = null;
      }
      if (c) clips.push(c);
    }
  }
  const dsIds = [...new Set(clips.map((c) => c.dataset))].sort();
  console.log(
    `split=${split} stage=${stage} clips=${clips.length} ` +
      `(${dsIds.map((d) => `${d}:${clips.filter((c) => c.dataset === d).length}`).join(' ')})`,
  );

  const header =
    'config'.padEnd(22) +
    dsIds.map((d) => `${d.slice(0, 12)} COnP/F2/n`.padEnd(16)).join('') +
    'meanCOnP'.padEnd(10) +
    'meanF2'.padEnd(8) +
    'worstF1';
  console.log('\n' + header);
  console.log('-'.repeat(header.length));

  const results: {
    name: string; mean: number; worst: number; line: string; f2: number;
    /** Per-clip F1@0.1 in a fixed clip order — the paired-bootstrap input. */
    perClip: number[];
    /** Pooled segmentation-error counts — HOW it is wrong, not just how much. */
    seg: SegErrorCounts;
  }[] = [];
  for (const cfg of selected) {
    const per: Record<string, Acc> = {};
    for (const d of dsIds) per[d] = newAcc();

    const extractor = new NoteExtractor(cfg.ext);
    const perClip: number[] = [];
    const seg: SegErrorCounts = {
      clean: 0, split: 0, merged: 0, missed: 0, spurious: 0,
      tangled: 0, pitchWrong: 0, refTotal: 0, estTotal: 0,
    };

    for (const c of clips) {
      const segOpts: NoteSegmenterOptions = {
        confidenceThreshold: c.profile.confidenceThreshold ?? 0.5,
        minFreqHz: c.profile.minFreqHz,
        maxFreqHz: c.profile.maxFreqHz,
        minFrames: c.profile.minFramesPerNote ?? 4,
        ...cfg.seg,
      };
      const raw = cfg.legacy
        ? legacySegment(c, cfg.legacyOver)
        : new NoteSegmenter(segOpts).segment(c.track, c.energy);

      let notes = raw;
      if (stage !== 'seg') {
        if (!cfg.noClean) {
          const onsetTimesSec = cfg.ratioSplitSens
            ? ratioOnsets(c.energy, c.track.hopSec, cfg.ratioSplitSens)
            : c.onsetTimesSec;
          notes = extractor.clean(raw, { bpm: 120, onsetTimesSec });
        }
        if (stage === 'quant') notes = extractor.quantize(notes, 120);
      }
      record(per[c.dataset], c.truth, toEst(notes));
      perClip.push(
        scoreNotesBest(c.truth, toEst(notes), { onsetTolSec: 0.1, timingTolSec: 0.3 }).f1,
      );
      const e = segErrors(c.truth.notes, toEst(notes));
      for (const k of Object.keys(seg) as Array<keyof SegErrorCounts>) seg[k] += e[k];
    }

    const f1s = dsIds.map((d) => mean(per[d].f1['0.1']));
    const f2s = dsIds.map((d) => mean(per[d].f2));
    const m = mean(f1s);
    const worst = Math.min(...f1s);
    const line =
      cfg.name.padEnd(22) +
      // per dataset: F1 / F2 / est-per-ref ratio, so a config that "wins" by
      // dropping notes is visible rather than hidden in an average.
      dsIds
        .map((d, i) => {
          const ratio = mean(per[d].estN) / Math.max(1e-9, mean(per[d].refN));
          return `${f1s[i].toFixed(2)}/${f2s[i].toFixed(2)}/${ratio.toFixed(2)}`.padEnd(16);
        })
        .join('') +
      m.toFixed(3).padEnd(8) +
      mean(f2s).toFixed(3).padEnd(8) +
      worst.toFixed(3);
    console.log(line);
    results.push({ name: cfg.name, mean: m, worst, line, f2: mean(f2s), perClip, seg });
  }

  // Every config vs the shipping baseline, PAIRED over the same clips. Without an
  // interval a 1-2 point difference on ~60 clips is indistinguishable from noise,
  // and most differences this sweep produces are in that band.
  const baseline = results.find((r) => r.name === baselineName)
    ?? results.find((r) => r.name.startsWith(baselineName));
  if (baseline) {
    console.log(
      `\n--- vs ${baseline.name}, paired bootstrap over clips (* = CI excludes 0)` +
        `${excluded.size ? `, excluding ${[...excluded].join(',')}` : ''} ---`,
    );
    for (const r of [...results].sort((x, y) => y.mean - x.mean)) {
      if (r === baseline) continue;
      const cmp = pairedDiffCI(baseline.perClip, r.perClip);
      console.log(`${r.name.padEnd(22)} ${formatComparison(cmp)}`);
    }
  }

  // How each config is wrong, per 100 reference notes. Read `missed` first: a missing
  // note costs ~145 s of expert time to restore versus ~3.5 s to delete a spurious
  // one, so two configs with the same F1 are not equally good products.
  console.log(
    '\n--- segmentation errors per 100 reference notes, ranked by estimated repair time ---',
  );
  for (const r of [...results].sort(
    (a, b) => repairSecondsPer100(a.seg) - repairSecondsPer100(b.seg),
  )) {
    console.log(`${r.name.padEnd(22)} ${formatSegErrors(r.seg)}`);
  }

  console.log('\n--- ranked by mean COnP@0.1 ---');
  for (const r of [...results].sort((a, b) => b.mean - a.mean).slice(0, 6)) {
    console.log(`F1=${r.mean.toFixed(3)}  F2=${r.f2.toFixed(3)}  worst=${r.worst.toFixed(3)}  ${r.name}`);
  }
  console.log('\n--- ranked by mean F2 (recall-weighted — the product-relevant order) ---');
  for (const r of [...results].sort((a, b) => b.f2 - a.f2).slice(0, 6)) {
    console.log(`F2=${r.f2.toFixed(3)}  F1=${r.mean.toFixed(3)}  worst=${r.worst.toFixed(3)}  ${r.name}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
