/**
 * Note-transcription metrics, mir_eval-style. A reference note matches an
 * estimated note when their onsets fall within a tolerance window and the pitch
 * matches. We report two pitch criteria:
 *   - exact MIDI match -> precision / recall / F1
 *   - octave-agnostic (same pitch class) -> chroma F1, and the gap between the
 *     two surfaces the octave-error rate (the classic pitch-tracker failure).
 *
 * Separately we measure *timing* on the correctly-pitched notes: the signed
 * onset/offset error of each matched estimate vs. its reference. This is a
 * diagnostic, not a match gate — it tells us whether the pipeline places notes
 * systematically early/late (a constant offset, fixable by calibration) or just
 * jittery (spread, already absorbed by quantization). To avoid the F1 onset
 * window censoring large errors, the timing pass uses its own, wider tolerance.
 */

import type { TruthNote } from '../types';

export interface EstNote {
  onsetSec: number;
  durSec: number;
  midi: number;
}

/** Signed timing error stats over correctly-pitched matches. + = late. */
export interface TimingStats {
  /** Number of matched pairs the timing stats are computed over. */
  matched: number;
  /** Raw signed onset errors (est − ref), milliseconds. Kept for histograms. */
  onsetDeltasMs: number[];
  /** Raw signed offset (end-time) errors (est − ref), milliseconds. */
  offsetDeltasMs: number[];
  /** Mean signed onset error (ms). + = pipeline places notes late. */
  onsetBiasMs: number;
  /** Median signed onset error (ms) — robust to a few wild notes. */
  onsetMedianMs: number;
  /** Std-dev of signed onset error (ms) — the jitter / spread. */
  onsetStdMs: number;
  /** Mean absolute onset error (ms) — magnitude regardless of direction. */
  onsetMaeMs: number;
  /** Mean signed offset error (ms). + = notes end late (run long). */
  offsetBiasMs: number;
}

export interface Metrics {
  refCount: number;
  estCount: number;
  matched: number; // exact-pitch matches
  precision: number;
  recall: number;
  f1: number;
  /** Matches allowing octave errors (same pitch class). */
  chromaMatched: number;
  chromaF1: number;
  /** Fraction of ref notes matched on chroma but at the wrong octave. */
  octaveErrorRate: number;
  /** Median absolute pitch error (semitones) over chroma-matched pairs. */
  medianPitchErr: number;
  /** Signed onset/offset timing error over exact-pitch matches. */
  timing: TimingStats;
}

export interface MatchOptions {
  /** Onset window for counting a pitch match (drives precision/recall/F1). */
  onsetTolSec: number;
  /**
   * Wider onset window used only for the timing diagnostic, so a note that is
   * (say) 180 ms late still contributes its true error instead of being dropped
   * as unmatched. Notes off by more than this are treated as wrong, not late.
   */
  timingTolSec: number;
}

interface MatchResult {
  matched: number;
  /** Absolute pitch error (semitones) per matched pair. */
  pitchErrs: number[];
  /** Signed onset error (est − ref) per matched pair, seconds. */
  onsetDeltas: number[];
  /** Signed offset (end-time) error (est − ref) per matched pair, seconds. */
  offsetDeltas: number[];
}

/**
 * Greedy onset-ordered matcher. For each reference note (sorted by onset) take
 * the closest unused estimated note within the onset window that satisfies the
 * pitch predicate.
 */
function countMatches(
  ref: TruthNote[],
  est: EstNote[],
  onsetTol: number,
  pitchOk: (r: number, e: number) => boolean,
): MatchResult {
  const used = new Array(est.length).fill(false);
  const sortedRef = [...ref].sort((a, b) => a.onsetSec - b.onsetSec);
  let matched = 0;
  const pitchErrs: number[] = [];
  const onsetDeltas: number[] = [];
  const offsetDeltas: number[] = [];

  for (const r of sortedRef) {
    let best = -1;
    let bestDist = Infinity;
    for (let j = 0; j < est.length; j += 1) {
      if (used[j]) continue;
      const dt = Math.abs(est[j].onsetSec - r.onsetSec);
      if (dt > onsetTol) continue;
      if (!pitchOk(r.midi, est[j].midi)) continue;
      if (dt < bestDist) {
        bestDist = dt;
        best = j;
      }
    }
    if (best >= 0) {
      used[best] = true;
      matched += 1;
      pitchErrs.push(Math.abs(est[best].midi - r.midi));
      onsetDeltas.push(est[best].onsetSec - r.onsetSec);
      offsetDeltas.push(
        est[best].onsetSec + est[best].durSec - (r.onsetSec + r.durSec),
      );
    }
  }
  return { matched, pitchErrs, onsetDeltas, offsetDeltas };
}

function f1(matched: number, refCount: number, estCount: number): number {
  const p = estCount ? matched / estCount : 0;
  const r = refCount ? matched / refCount : 0;
  return p + r > 0 ? (2 * p * r) / (p + r) : 0;
}

function meanOf(xs: number[]): number {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
}

function median(xs: number[]): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function stdOf(xs: number[]): number {
  if (xs.length < 2) return 0;
  const mu = meanOf(xs);
  return Math.sqrt(meanOf(xs.map((x) => (x - mu) ** 2)));
}

/**
 * Summarize signed timing deltas (milliseconds). Works on per-clip deltas or on
 * a pool across many clips, so callers can aggregate without re-implementing the
 * stats. Onset and offset delta arrays are paired (same matches) but summarized
 * independently.
 */
export function timingStats(
  onsetDeltasMs: number[],
  offsetDeltasMs: number[],
): TimingStats {
  return {
    matched: onsetDeltasMs.length,
    onsetDeltasMs,
    offsetDeltasMs,
    onsetBiasMs: meanOf(onsetDeltasMs),
    onsetMedianMs: median(onsetDeltasMs),
    onsetStdMs: stdOf(onsetDeltasMs),
    onsetMaeMs: meanOf(onsetDeltasMs.map(Math.abs)),
    offsetBiasMs: meanOf(offsetDeltasMs),
  };
}

export function scoreNotes(
  ref: TruthNote[],
  est: EstNote[],
  opts: MatchOptions = { onsetTolSec: 0.1, timingTolSec: 0.3 },
): Metrics {
  const exact = countMatches(ref, est, opts.onsetTolSec, (r, e) => r === e);
  const chroma = countMatches(
    ref,
    est,
    opts.onsetTolSec,
    (r, e) => ((r - e) % 12 + 12) % 12 === 0,
  );

  // Timing is measured on exact-pitch matches in a wider window, so a late note
  // contributes its real error rather than falling outside the F1 gate.
  const timingPass = countMatches(
    ref,
    est,
    opts.timingTolSec,
    (r, e) => r === e,
  );
  const timing = timingStats(
    timingPass.onsetDeltas.map((s) => s * 1000),
    timingPass.offsetDeltas.map((s) => s * 1000),
  );

  const precision = est.length ? exact.matched / est.length : 0;
  const recall = ref.length ? exact.matched / ref.length : 0;

  return {
    refCount: ref.length,
    estCount: est.length,
    matched: exact.matched,
    precision,
    recall,
    f1: f1(exact.matched, ref.length, est.length),
    chromaMatched: chroma.matched,
    chromaF1: f1(chroma.matched, ref.length, est.length),
    octaveErrorRate: ref.length
      ? (chroma.matched - exact.matched) / ref.length
      : 0,
    medianPitchErr: median(chroma.pitchErrs),
    timing,
  };
}
