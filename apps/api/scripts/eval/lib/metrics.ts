/**
 * Note-transcription metrics, mir_eval-style. A reference note matches an
 * estimated note when their onsets fall within a tolerance window and the pitch
 * matches. We report two pitch criteria:
 *   - exact MIDI match -> precision / recall / F1
 *   - octave-agnostic (same pitch class) -> chroma F1, and the gap between the
 *     two surfaces the octave-error rate (the classic pitch-tracker failure).
 */

import type { TruthNote } from '../types';

export interface EstNote {
  onsetSec: number;
  durSec: number;
  midi: number;
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
}

interface MatchOptions {
  onsetTolSec: number;
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
): { matched: number; errs: number[] } {
  const used = new Array(est.length).fill(false);
  const sortedRef = [...ref].sort((a, b) => a.onsetSec - b.onsetSec);
  let matched = 0;
  const errs: number[] = [];

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
      errs.push(Math.abs(est[best].midi - r.midi));
    }
  }
  return { matched, errs };
}

function f1(matched: number, refCount: number, estCount: number): number {
  const p = estCount ? matched / estCount : 0;
  const r = refCount ? matched / refCount : 0;
  return p + r > 0 ? (2 * p * r) / (p + r) : 0;
}

function median(xs: number[]): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export function scoreNotes(
  ref: TruthNote[],
  est: EstNote[],
  opts: MatchOptions = { onsetTolSec: 0.1 },
): Metrics {
  const exact = countMatches(ref, est, opts.onsetTolSec, (r, e) => r === e);
  const chroma = countMatches(
    ref,
    est,
    opts.onsetTolSec,
    (r, e) => ((r - e) % 12 + 12) % 12 === 0,
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
    medianPitchErr: median(chroma.errs),
  };
}
