/**
 * Metrics for **notation** quality, as distinct from detection quality.
 *
 * ## Why the existing metric cannot do this job
 *
 * Note-F1 with an onset tolerance in *seconds* does not measure whether a score is
 * right; measured on GuitarSet (the one corpus with a real annotated tempo):
 *
 *   not quantising at all .................. 0.851
 *   quantising at the TRUE tempo (117) ..... 0.798
 *   quantising at ~2× the true tempo (229) . 0.850
 *
 * A finer grid subdivides more finely in absolute time, so it displaces onsets
 * less, so it scores better in seconds — however unmusical the result. Optimising
 * that metric drives the product toward emitting un-notated free time. So the
 * rhythm stage needs metrics that live in **beats**, not seconds.
 *
 * ## The three things measured here
 *
 * 1. `onsetBeatF1` — onsets matched on the **metrical grid**, in beats. Because
 *    both sides are expressed in beats, choosing double the tempo now *doubles*
 *    every estimated beat position and is penalised, which is exactly the error
 *    seconds-F1 rewards. A global metrical `scale` (1, 2, ½, 3, ⅓ …) is searched
 *    and **reported**: needing scale ≠ 1 is itself the classic half/double-tempo
 *    failure, and hiding it inside the match would defeat the purpose.
 *
 * 2. `noteValueAccuracy` — of the matched notes, the fraction whose written
 *    duration is right. This is the half of the problem every published system
 *    finds hardest (onset F1 ~97 % vs note-value ~83 % in the best reported work),
 *    and the pipeline currently has no measurement of it at all.
 *
 * 3. `complexity` — reference-free readability counters (tuplets, notes below a
 *    16th, off-grid onsets, distinct durations used). A page carrying forty tuplets
 *    is a bad transcription *whatever* its onset accuracy, and unlike the other two
 *    these need no ground truth, so they work on the free-tempo singing corpora too,
 *    where no notated reference can honestly be derived.
 *
 *    **Caveat, measured:** against the *current* quantiser these read 0 everywhere
 *    except `distinctDurations`. That is not a bug in the counters — it is because
 *    `maxGridDivisor: 4` snaps every onset to the quarter-beat grid and every length
 *    to the standard set, so a tuplet, a sub-16th and an off-grid onset are all
 *    unrepresentable by construction. They therefore act as a **regression guard**
 *    (they will light up the moment triplets or a finer grid are introduced) rather
 *    than as a live signal. `distinctDurations` is the one that currently varies.
 */

import type { TruthNote } from '../types';

/** Note with times already expressed in beats. */
export interface BeatNote {
  onsetBeat: number;
  durBeat: number;
  midi: number;
}

/**
 * Metrical scales tried when matching. A transcription an octave out in *tempo*
 * (half or double) is the single most common rhythm failure in the literature, and
 * 3 / ⅓ / 3⁄2 / ⅔ cover the duple-vs-triple confusions.
 */
const SCALES = [1, 2, 0.5, 3, 1 / 3, 1.5, 2 / 3, 4, 0.25];

/** Grid the reference is assumed to live on: 1/12 beat represents straight AND triplet. */
const REFERENCE_GRID = 12;

export interface ComplexityCounts {
  /** Notes whose duration is not a multiple of 1/4 beat — i.e. beyond a 16th note. */
  subSixteenth: number;
  /** Notes whose duration needs a tuplet (a multiple of 1/3 but not 1/4 of a beat). */
  tuplets: number;
  /** Onsets not on a 1/4-beat position — each is a tie or an awkward rest in print. */
  offGrid: number;
  /** Distinct written durations used. A readable score uses few. */
  distinctDurations: number;
}

export interface NotationScore {
  /** Onsets matched on the metrical grid, ±`tolBeat`. */
  onsetBeatF1: number;
  onsetBeatPrecision: number;
  onsetBeatRecall: number;
  /** Global metrical scale the best match needed. ≠1 ⇒ half/double-tempo error. */
  scale: number;
  /** Of matched notes, fraction whose written duration is correct. */
  noteValueAccuracy: number;
  /** Matched note count the two figures above rest on. */
  matched: number;
  complexity: ComplexityCounts;
}

function f1(matched: number, ref: number, est: number): number {
  const p = est ? matched / est : 0;
  const r = ref ? matched / ref : 0;
  return p + r > 0 ? (2 * p * r) / (p + r) : 0;
}

/** Seconds → beats at a fixed tempo. */
export function toBeats(
  notes: { onsetSec: number; durSec: number; midi: number }[],
  bpm: number,
): BeatNote[] {
  const bps = bpm / 60;
  return notes.map((n) => ({
    onsetBeat: n.onsetSec * bps,
    durBeat: n.durSec * bps,
    midi: n.midi,
  }));
}

export function truthToBeats(notes: TruthNote[], bpm: number): BeatNote[] {
  return toBeats(notes, bpm);
}

/** Snap to the nearest 1/`grid` beat. */
function snap(beat: number, grid = REFERENCE_GRID): number {
  return Math.round(beat * grid) / grid;
}

export class NotationScorer {
  constructor(
    /** Onset tolerance in beats. 1/8 beat = a 32nd note — tight but notational. */
    private readonly tolBeat = 0.125,
    /** Note-value tolerance in beats; 1/12 admits straight and triplet spellings. */
    private readonly durTolBeat = 1 / 12,
    /**
     * Whether to search a global phase offset before matching.
     *
     * `true` (default) forgives "the whole take sits half a beat late", which is
     * right when the corpus has no anchored beat 1 — the question is then whether
     * the *relative* rhythm is notated correctly.
     *
     * `false` is the stricter and more product-truthful setting for a corpus that
     * was recorded to a click (GuitarSet), because there beat 1 is at a known
     * instant and a displaced take really is wrong: the user sees their melody
     * printed on the wrong beats. It is also the only setting that can see a
     * constant capture-start latency, which phase search absorbs by construction.
     */
    private readonly allowPhaseSearch = true,
  ) {}

  /**
   * Score `est` against `ref`, both in beats on their own grids. The estimate's
   * beat axis is rescaled and shifted to find the best metrical alignment, because
   * a transcription at half tempo with everything otherwise perfect is a *tempo*
   * error, not a hundred onset errors, and should be reported as such.
   */
  score(ref: BeatNote[], est: BeatNote[]): NotationScore {
    let best: NotationScore | null = null;
    for (const scale of SCALES) {
      const scaled = est.map((n) => ({
        onsetBeat: n.onsetBeat * scale,
        durBeat: n.durBeat * scale,
        midi: n.midi,
      }));
      // Try the phase offsets implied by aligning the first few estimated notes to
      // the first few reference notes, plus zero. Cheaper and better targeted than
      // a blind grid: the right offset almost always aligns some note pair.
      const offsets = new Set<number>([0]);
      if (this.allowPhaseSearch) {
        for (let i = 0; i < Math.min(3, scaled.length); i += 1) {
          for (let j = 0; j < Math.min(3, ref.length); j += 1) {
            offsets.add(ref[j].onsetBeat - scaled[i].onsetBeat);
          }
        }
      }
      for (const off of offsets) {
        const shifted = scaled.map((n) => ({ ...n, onsetBeat: n.onsetBeat + off }));
        const s = this.matchAt(ref, shifted, scale);
        if (!best || s.onsetBeatF1 > best.onsetBeatF1) best = s;
      }
    }
    const fallback: NotationScore = {
      onsetBeatF1: 0, onsetBeatPrecision: 0, onsetBeatRecall: 0, scale: 1,
      noteValueAccuracy: 0, matched: 0, complexity: this.complexity(est),
    };
    return best ?? fallback;
  }

  /**
   * Greedy onset-ordered match on the beat axis, requiring the pitch to agree.
   * Note-value accuracy is computed only over matched pairs — asking whether an
   * unmatched note's duration is right is meaningless.
   */
  private matchAt(ref: BeatNote[], est: BeatNote[], scale: number): NotationScore {
    const used = new Array(est.length).fill(false);
    const sortedRef = [...ref].sort((a, b) => a.onsetBeat - b.onsetBeat);
    let matched = 0;
    let durRight = 0;

    for (const r of sortedRef) {
      let bestIdx = -1;
      let bestDist = Infinity;
      for (let j = 0; j < est.length; j += 1) {
        if (used[j] || est[j].midi !== r.midi) continue;
        const d = Math.abs(est[j].onsetBeat - r.onsetBeat);
        if (d <= this.tolBeat && d < bestDist) {
          bestDist = d;
          bestIdx = j;
        }
      }
      if (bestIdx < 0) continue;
      used[bestIdx] = true;
      matched += 1;
      // Compare WRITTEN durations — both snapped to the notation grid, since a
      // duration is only "wrong" if it would be engraved differently.
      if (
        Math.abs(snap(est[bestIdx].durBeat) - snap(r.durBeat)) <= this.durTolBeat + 1e-9
      ) {
        durRight += 1;
      }
    }

    return {
      onsetBeatF1: f1(matched, ref.length, est.length),
      onsetBeatPrecision: est.length ? matched / est.length : 0,
      onsetBeatRecall: ref.length ? matched / ref.length : 0,
      scale,
      noteValueAccuracy: matched ? durRight / matched : 0,
      matched,
      complexity: this.complexity(est),
    };
  }

  /**
   * Reference-free readability counters. These are the numbers that correlate with
   * "this page is unreadable" complaints, and they are the only notation signal
   * available on the free-tempo corpora, where no notated reference exists.
   */
  complexity(est: BeatNote[]): ComplexityCounts {
    let subSixteenth = 0;
    let tuplets = 0;
    let offGrid = 0;
    const durations = new Set<number>();

    for (const n of est) {
      const d = snap(n.durBeat);
      durations.add(d);
      const onQuarterGrid = Math.abs(d * 4 - Math.round(d * 4)) < 1e-6;
      if (!onQuarterGrid) {
        // Not writable as a 16th-note multiple. If it IS a third of a beat it is a
        // tuplet; otherwise it is finer than the notation grid can carry.
        if (Math.abs(d * 3 - Math.round(d * 3)) < 1e-6) tuplets += 1;
        else subSixteenth += 1;
      }
      if (Math.abs(n.onsetBeat * 4 - Math.round(n.onsetBeat * 4)) > 1e-6) offGrid += 1;
    }
    return { subSixteenth, tuplets, offGrid, distinctDurations: durations.size };
  }
}
