/**
 * Onset taxonomy for voice: **re-onset vs transition vs silence-onset**.
 *
 * F1 (and even the split/merge taxonomy in `segErrors.ts`) cannot tell us the one
 * thing the voice flow is actually trying to fix, because the two kinds of note
 * boundary in singing carry completely different evidence and fail for completely
 * different reasons:
 *
 *  - **transition** — the pitch changes. A pitch-trajectory segmenter sees this for
 *    free; it is what `segmentNotesBySemitone` is built on.
 *  - **re-onset** — the pitch does NOT change; the singer re-articulates the same
 *    note ("la-la-la"). A pure f0 segmentation is *structurally incapable* of
 *    finding these — only energy, phonetics, or a pitch dip can.
 *  - **silence-onset** — the note is preceded by a real gap. The easy case.
 *
 * Definition taken verbatim from Yong, Su & Nam, *Phoneme-informed note-level
 * singing transcription* (ICASSP 2023, arXiv:2304.05917): a note whose onset falls
 * within `gapSec` (they use 20 ms) of the previous note's offset is *connected*;
 * connected + same pitch = re-onset, connected + different pitch = transition.
 * Everything else is a silence-onset. Theirs is the only paper that publishes
 * recall conditioned on this split, and it is the number that says whether a new
 * boundary channel works: a change that lifts overall F1 by merging everything is
 * indistinguishable from a real improvement until re-onset recall is reported
 * separately.
 *
 * Recall here is **onset-only (COn)**, deliberately: these classes are about where
 * a boundary is found, not about what pitch was written there, and gating on pitch
 * would mix a decode failure into a boundary metric.
 */

import type { TruthNote } from '../types';
import type { EstNote } from './metrics';

export type OnsetClass = 'reonset' | 'transition' | 'silence';

/** Yong et al.'s connectedness threshold: 20 ms between offset and next onset. */
export const CONNECTED_GAP_SEC = 0.02;

export interface ClassRecall {
  matched: number;
  total: number;
}

export interface OnsetClassStats {
  reonset: ClassRecall;
  transition: ClassRecall;
  silence: ClassRecall;
}

export function emptyOnsetClassStats(): OnsetClassStats {
  return {
    reonset: { matched: 0, total: 0 },
    transition: { matched: 0, total: 0 },
    silence: { matched: 0, total: 0 },
  };
}

export function addOnsetClassStats(
  into: OnsetClassStats,
  from: OnsetClassStats,
): void {
  for (const k of ['reonset', 'transition', 'silence'] as const) {
    into[k].matched += from[k].matched;
    into[k].total += from[k].total;
  }
}

/**
 * Class of every reference onset, in the reference's own onset order. The first
 * note of a clip is always a silence-onset (nothing precedes it).
 */
export function classifyOnsets(
  ref: TruthNote[],
  gapSec = CONNECTED_GAP_SEC,
): OnsetClass[] {
  const sorted = [...ref].sort((a, b) => a.onsetSec - b.onsetSec);
  return sorted.map((n, i) => {
    if (i === 0) return 'silence';
    const prev = sorted[i - 1];
    const gap = n.onsetSec - (prev.onsetSec + prev.durSec);
    if (gap > gapSec) return 'silence';
    return n.midi === prev.midi ? 'reonset' : 'transition';
  });
}

/**
 * Per-class onset recall. Greedy nearest-unused matching within `tolSec`, ordered
 * by reference onset — the same discipline as `metrics.countMatches`, minus the
 * pitch predicate.
 */
export function onsetRecallByClass(
  ref: TruthNote[],
  est: EstNote[],
  tolSec = 0.1,
): OnsetClassStats {
  const sorted = [...ref].sort((a, b) => a.onsetSec - b.onsetSec);
  const classes = classifyOnsets(sorted);
  const used = new Array(est.length).fill(false);
  const stats = emptyOnsetClassStats();

  for (let i = 0; i < sorted.length; i += 1) {
    const cls = classes[i];
    stats[cls].total += 1;
    let best = -1;
    let bestDist = Infinity;
    for (let j = 0; j < est.length; j += 1) {
      if (used[j]) continue;
      const dt = Math.abs(est[j].onsetSec - sorted[i].onsetSec);
      if (dt > tolSec || dt >= bestDist) continue;
      bestDist = dt;
      best = j;
    }
    if (best >= 0) {
      used[best] = true;
      stats[cls].matched += 1;
    }
  }
  return stats;
}

const pct = (c: ClassRecall): string =>
  c.total ? (c.matched / c.total).toFixed(3) : ' n/a ';

/** `reOn=0.61(180) trans=0.84(983) sil=0.79(1034)` — recall with the class's n. */
export function formatOnsetClasses(s: OnsetClassStats): string {
  return (
    `reOn=${pct(s.reonset)}(${s.reonset.total}) ` +
    `trans=${pct(s.transition)}(${s.transition.total}) ` +
    `sil=${pct(s.silence)}(${s.silence.total})`
  );
}
