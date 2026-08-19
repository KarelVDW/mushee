import type { NoteEventTime } from '@spotify/basic-pitch';

import type { PitchTrack } from './pitch-track';

/**
 * Turn a frame-level pitch trajectory into discrete notes by Viterbi decoding a
 * note-level HMM, following the model pYIN uses for its note transcription
 * (Mauch et al., *Computer-aided Melody Note Transcription Using the Tony
 * Software*, TENOR 2015) — the tool built specifically for hand-annotating solo
 * singing, which is our hardest input.
 *
 * ## Why not round each frame to the nearest semitone?
 *
 * That is what the pipeline did (round, median-filter, emit a note per run of
 * equal semitone) and it over-segments badly: measured 18 notes emitted for 7
 * actually sung on studio singing. Three causes, none of them fixable locally:
 *
 *  - **Vibrato.** Trained singers swing ±50–100 cents at 5–7 Hz. A note centred
 *    near a semitone boundary flips between two semitones for its whole duration,
 *    and the median of a coin-flip is a coin-flip.
 *  - **Portamento.** Sliding C4→E4 dwells ~40 ms each on C♯ and D♯. Those frames
 *    genuinely *are* those pitches; nothing local can tell travel from arrival.
 *  - **Onset transients.** Singers scoop into notes — a real take was measured
 *    starting 55 cents flat and arriving only ~150 ms later.
 *
 * ## The three ideas that fix it
 *
 * 1. **A note-change cost.** Every boundary costs `changeCost` nats, so a brief
 *    vibrato excursion must pay it twice — leaving and returning — and loses to
 *    staying put however confidently those frames read as the neighbour. A real
 *    note pays once and wins easily. The decision is duration- and
 *    evidence-weighted over the whole take rather than a local threshold that must
 *    be either too strict (eats short notes) or too loose (lets flutter through).
 *
 * 2. **Sub-semitone states.** States sit every 1/`stepsPerSemitone` of a semitone,
 *    not on semitones, so a note sung consistently 40 cents flat has a state that
 *    actually fits it and does not have to keep choosing between two poor ones.
 *
 * 3. **Attack states with a much wider variance than sustain states.** Each pitch
 *    has an `attack` and a `stable` phase; attack tolerates σ≈5 semitones of
 *    deviation while stable tolerates σ≈0.9. This is what absorbs scoops and
 *    glides *into* the note they belong to instead of spawning notes for the
 *    pitches passed through — reported as the single most important reason pYIN
 *    survives expressive singing.
 *
 * A note's reported pitch is the **median of the underlying contour** over its
 * span, not the state index: the states exist to find boundaries, and the contour
 * is the better pitch estimate once the boundaries are known.
 *
 * ## ⚠ NOT on the shipping path — and why it is kept anyway
 *
 * Measured against the semitone-run segmenter it replaces, **every** configuration
 * of this model scored worse on the real corpus (−0.06 to −0.16 F1@0.1, all 22
 * configs, every confidence interval excluding zero). It wins only on vocadito in
 * isolation, which is already at its human inter-annotator ceiling and therefore the
 * least valuable place to win. `CrepeProvider` still uses `segmentNotes`.
 *
 * It is retained because the *diagnosis* is informative and the fix is identified:
 * the datasets want opposite `changeCost` values — sustained vibrato-heavy singing
 * needs a high cost, fast humming a low one — so a single global setting provably
 * cannot serve both. The next step is a two-pass **adaptive** cost, scaled from the
 * take's own measured note density and vibrato extent. See the findings log in
 * `scripts/eval/README.md` for the numbers. Exercised by `scripts/eval/sweep-segmenter.ts`.
 */
export interface NoteSegmenterOptions {
  /** Voicing gate on the track's per-frame confidence. */
  confidenceThreshold?: number;
  /** Register window; voiced frames outside it are treated as unvoiced. */
  minFreqHz?: number;
  maxFreqHz?: number;
  /** Block-level voiced-fraction quorum on the gate (R19; see `PitchTrack.voicedMask`). */
  voicedQuorum?: { minFraction?: number; windowSec?: number };
  /** Pitch states per semitone. 3 (pYIN's value) resolves ~33-cent detuning. */
  stepsPerSemitone?: number;
  /** Emission σ for a note's attack phase, in semitones — deliberately wide. */
  sigmaAttackSemitones?: number;
  /** Emission σ for a note's stable phase, in semitones — deliberately narrow. */
  sigmaStableSemitones?: number;
  /**
   * Exponent applied to the emission likelihood: how much the per-frame pitch
   * estimate is trusted relative to the transition structure. Low values (pYIN
   * uses 0.1) let the note model dominate, which is what makes it stable.
   */
  trust?: number;
  /** Cost in nats of leaving a note for a different pitch. The dominant knob. */
  changeCost?: number;
  /** Cost of a note's attack phase giving way to its stable phase. */
  attackCost?: number;
  /**
   * Cost charged for time spent in a note's attack phase — what makes the
   * attack **transient**. Declared in nats **per 10 ms** of dwell and rescaled
   * to the track's actual hop at decode time (Praat's convention), so the knob
   * keeps its meaning if the hop ever changes.
   *
   * Without it the model collapses: the attack state's wide σ fits any pitch
   * almost free, so the cheapest path is to enter one attack state and never
   * leave, emitting a single note for the whole take (measured: 14 notes where 27
   * were sung). pYIN gets this for nothing from its attack self-transition
   * probability of 0.9 (vs 0.99 for stable).
   */
  attackFrameCost?: number;
  /** Cost of starting a note out of silence. */
  onCost?: number;
  /** Cost of ending a note into silence. */
  offCost?: number;
  /**
   * Emission cost charged to a pitch state on an UNVOICED frame. Small values let
   * a note ride through a brief dropout (a consonant, a breath) rather than being
   * cut in two; large values make voicing authoritative.
   */
  unvoicedPitchCost?: number;
  /** Emission cost charged to silence on a VOICED frame. */
  voicedSilenceCost?: number;
  /** Shortest note kept, in seconds. Absorbed into a neighbour, not just dropped. */
  minNoteSec?: number;
  /**
   * Exempt a run shorter than `minNoteSec` from absorption when its peak energy
   * reaches this multiple of the clip's median voiced energy — WaoN's joint
   * duration × velocity rule: short AND quiet is a glitch, short and loud is
   * staccato. Needs `energy`; omit to absorb every short run.
   */
  keepShortLoudRatio?: number;
  /**
   * Drop a note that is long AND quiet — at least `minSec` long with mean energy
   * below `quietRatio` × the clip's median voiced energy (WaoN's second pass:
   * the shape of a reverb tail). Needs `energy`; omit to keep every long note.
   */
  dropLongQuiet?: { minSec?: number; quietRatio?: number };
  /**
   * Minimum interval, in semitones, that a note change may be. Below this a pitch
   * difference is treated as expression within one note rather than a new note —
   * pYIN allows only "the same, or at least 2/3 of a semitone different".
   */
  minChangeSemitones?: number;
  /**
   * When set, a pitch change coinciding with a dip in amplitude is discounted to
   * this fraction of `changeCost` — a re-articulation you can *hear* should be
   * cheaper to write down than one visible only in the pitch curve. Needs
   * `energy`; omit to ignore amplitude.
   */
  dipDiscount?: number;
  /** Energy must fall to this fraction of the local peak to count as a dip. */
  dipRatio?: number;
}

interface Run {
  start: number;
  end: number;
  /** Pitch-state index, or -1 for silence. */
  state: number;
}

export class NoteSegmenter {
  private readonly confidenceThreshold: number;
  private readonly minFreqHz: number;
  private readonly maxFreqHz: number;
  private readonly stepsPerSemitone: number;
  private readonly sigmaAttack: number;
  private readonly sigmaStable: number;
  private readonly trust: number;
  private readonly changeCost: number;
  private readonly attackCost: number;
  /** Nats per 10 ms of attack dwell; rescaled to the track's hop at decode. */
  private readonly attackFrameCost: number;
  private readonly onCost: number;
  private readonly offCost: number;
  private readonly unvoicedPitchCost: number;
  private readonly voicedSilenceCost: number;
  private readonly minNoteSec: number;
  private readonly minChangeSemitones: number;
  private readonly dipDiscount: number | undefined;
  private readonly dipRatio: number;
  private readonly keepShortLoudRatio: number | undefined;
  private readonly dropLongQuiet: { minSec?: number; quietRatio?: number } | undefined;
  private readonly voicedQuorum: { minFraction?: number; windowSec?: number } | undefined;

  constructor(opts: NoteSegmenterOptions = {}) {
    this.confidenceThreshold = opts.confidenceThreshold ?? 0.5;
    this.minFreqHz = opts.minFreqHz ?? 55;
    this.maxFreqHz = opts.maxFreqHz ?? 2200;
    this.stepsPerSemitone = Math.max(1, Math.round(opts.stepsPerSemitone ?? 3));
    this.sigmaAttack = opts.sigmaAttackSemitones ?? 5;
    this.sigmaStable = opts.sigmaStableSemitones ?? 0.9;
    this.trust = opts.trust ?? 0.1;
    this.changeCost = opts.changeCost ?? 1.2;
    this.attackCost = opts.attackCost ?? 0.2;
    this.attackFrameCost = opts.attackFrameCost ?? 0.175;
    this.onCost = opts.onCost ?? 0.5;
    this.offCost = opts.offCost ?? 0.5;
    this.unvoicedPitchCost = opts.unvoicedPitchCost ?? 1.5;
    this.voicedSilenceCost = opts.voicedSilenceCost ?? 1.5;
    this.minNoteSec = opts.minNoteSec ?? 0.1;
    this.minChangeSemitones = opts.minChangeSemitones ?? 2 / 3;
    this.dipDiscount = opts.dipDiscount;
    this.dipRatio = opts.dipRatio ?? 0.6;
    this.keepShortLoudRatio = opts.keepShortLoudRatio;
    this.dropLongQuiet = opts.dropLongQuiet;
    this.voicedQuorum = opts.voicedQuorum;
  }

  /**
   * Decode `track` into notes. `energy` (per-frame RMS on the track's frame grid)
   * is consulted only when `dipDiscount` is configured.
   */
  segment(track: PitchTrack, energy?: Float32Array): NoteEventTime[] {
    const frames = track.frames;
    if (frames === 0) return [];

    const voiced = track.voicedMask({
      confidenceThreshold: this.confidenceThreshold,
      minFreqHz: this.minFreqHz,
      maxFreqHz: this.maxFreqHz,
      quorum: this.voicedQuorum,
    });

    const grid = this.pitchGrid(track, voiced);
    if (!grid) return [];

    const discount = this.changeDiscount(frames, energy);
    const path = this.decode(track, voiced, grid, frames, discount);
    const minFrames = Math.max(1, Math.round(this.minNoteSec / track.hopSec));
    // Joint duration × velocity filters (WaoN), anchored to the clip's own
    // median voiced energy so "quiet" adapts to the take's level.
    const energyRef =
      this.keepShortLoudRatio !== undefined || this.dropLongQuiet
        ? medianVoicedEnergy(voiced, frames, energy)
        : null;
    const keepShortLoud =
      this.keepShortLoudRatio !== undefined && energyRef !== null && energy
        ? (run: Run): boolean =>
            peakOver(energy, run) >= this.keepShortLoudRatio! * energyRef
        : undefined;
    const longQuiet =
      this.dropLongQuiet && energyRef !== null && energy
        ? {
            minFrames: Math.max(
              1,
              Math.round((this.dropLongQuiet.minSec ?? 0.35) / track.hopSec),
            ),
            floor: (this.dropLongQuiet.quietRatio ?? 0.3) * energyRef,
          }
        : null;
    const runs = this.absorbShortRuns(this.runsOf(path, frames), minFrames, keepShortLoud);

    const notes: NoteEventTime[] = [];
    for (const run of runs) {
      if (run.state < 0) continue;
      if (
        longQuiet &&
        energy &&
        run.end - run.start >= longQuiet.minFrames &&
        meanOver(energy, run) < longQuiet.floor
      ) {
        continue;
      }
      const midi = this.medianMidi(track, voiced, run);
      if (midi === null) continue;
      notes.push({
        startTimeSeconds: run.start * track.hopSec,
        durationSeconds: (run.end - run.start) * track.hopSec,
        pitchMidi: midi,
        amplitude: this.peakConfidence(track, run),
      });
    }
    return notes;
  }

  /**
   * The sub-semitone state grid: cents centres spanning the voiced frames' own
   * range with a semitone of padding either side, so a state always exists that
   * fits the note actually sung.
   */
  private pitchGrid(
    track: PitchTrack,
    voiced: Uint8Array,
  ): { centres: Float32Array; step: number } | null {
    let lo = Infinity;
    let hi = -Infinity;
    for (let i = 0; i < track.frames; i += 1) {
      if (!voiced[i]) continue;
      const c = track.cents[i];
      if (c < lo) lo = c;
      if (c > hi) hi = c;
    }
    if (!Number.isFinite(lo)) return null;
    const step = 100 / this.stepsPerSemitone;
    const start = Math.floor((lo - 100) / step) * step;
    const end = Math.ceil((hi + 100) / step) * step;
    const n = Math.round((end - start) / step) + 1;
    const centres = new Float32Array(n);
    for (let i = 0; i < n; i += 1) centres[i] = start + i * step;
    return { centres, step };
  }

  /**
   * Per-frame multiplier on `changeCost`: 1 everywhere unless amplitude dips are
   * being credited, in which case frames in a local energy trough get
   * `dipDiscount`, making a boundary there cheap.
   */
  private changeDiscount(
    frames: number,
    energy: Float32Array | undefined,
  ): Float32Array | null {
    if (this.dipDiscount === undefined || !energy) return null;
    const out = new Float32Array(frames).fill(1);
    // Local peak over ±10 frames (~±200 ms) — long enough to span a note, short
    // enough that a quiet passage isn't compared against a loud one.
    const w = 10;
    for (let i = 0; i < frames; i += 1) {
      let peak = 0;
      const lo = Math.max(0, i - w);
      const hi = Math.min(frames - 1, i + w);
      for (let j = lo; j <= hi; j += 1) if (energy[j] > peak) peak = energy[j];
      if (peak > 0 && energy[i] < this.dipRatio * peak) out[i] = this.dipDiscount;
    }
    return out;
  }

  /**
   * Viterbi over states {silence} ∪ {attack(p), stable(p)}. Transitions are
   * structured rather than a full matrix, and the only non-local one — entering a
   * note from a *different* pitch — is resolved with prefix/suffix minima over the
   * stable states, so each frame costs O(states) instead of O(states²). That
   * matters: with 3 steps per semitone a two-octave range is already 73 pitches.
   */
  private decode(
    track: PitchTrack,
    voiced: Uint8Array,
    grid: { centres: Float32Array; step: number },
    frames: number,
    discount: Float32Array | null,
  ): Int32Array {
    const { centres, step } = grid;
    const n = centres.length;
    // Layout: 0 = silence, 1..n = attack(p), n+1..2n = stable(p).
    const numStates = 2 * n + 1;
    const ATTACK = 1;
    const STABLE = n + 1;
    // Interval below which a "change" is really expression inside one note.
    const guard = Math.max(1, Math.round((this.minChangeSemitones * 100) / step));

    const cost = new Float32Array(numStates);
    const next = new Float32Array(numStates);
    const back = new Int32Array(frames * numStates);
    const prefix = new Float32Array(n);
    const prefixAt = new Int32Array(n);
    const suffix = new Float32Array(n);
    const suffixAt = new Int32Array(n);

    const twoSigAttackSq = 2 * this.sigmaAttack * this.sigmaAttack;
    const twoSigStableSq = 2 * this.sigmaStable * this.sigmaStable;
    // Per-10 ms dwell cost rescaled to this track's hop (Praat's convention).
    const attackFrameCost = this.attackFrameCost * (track.hopSec / 0.01);

    const emit = (t: number, state: number): number => {
      if (state === 0) return voiced[t] ? this.voicedSilenceCost : 0;
      const isAttack = state < STABLE;
      if (!voiced[t]) {
        return this.unvoicedPitchCost + (isAttack ? attackFrameCost : 0);
      }
      const p = isAttack ? state - ATTACK : state - STABLE;
      const d = (track.cents[t] - centres[p]) / 100;
      const twoSigSq = isAttack ? twoSigAttackSq : twoSigStableSq;
      const dwell = isAttack ? attackFrameCost : 0;
      return (this.trust * (d * d)) / twoSigSq + dwell;
    };

    for (let s = 0; s < numStates; s += 1) cost[s] = emit(0, s);

    for (let t = 1; t < frames; t += 1) {
      // Cheapest stable state to the left of / right of each index, so
      // "best stable(p') with |p' − p| ≥ guard" is two array reads.
      let running = Infinity;
      let runningAt = -1;
      for (let p = 0; p < n; p += 1) {
        prefix[p] = running;
        prefixAt[p] = runningAt;
        const c = cost[STABLE + p];
        if (c < running) {
          running = c;
          runningAt = p;
        }
      }
      running = Infinity;
      runningAt = -1;
      for (let p = n - 1; p >= 0; p -= 1) {
        suffix[p] = running;
        suffixAt[p] = runningAt;
        const c = cost[STABLE + p];
        if (c < running) {
          running = c;
          runningAt = p;
        }
      }

      const change = this.changeCost * (discount ? discount[t] : 1);
      const silencePrev = cost[0];
      // Cheapest stable state overall — the predecessor for entering silence.
      let bestStable = Infinity;
      let bestStableAt = -1;
      for (let p = 0; p < n; p += 1) {
        if (cost[STABLE + p] < bestStable) {
          bestStable = cost[STABLE + p];
          bestStableAt = p;
        }
      }

      // Silence: stay silent, or end a note.
      {
        let best = silencePrev;
        let from = 0;
        if (bestStableAt >= 0 && bestStable + this.offCost < best) {
          best = bestStable + this.offCost;
          from = STABLE + bestStableAt;
        }
        next[0] = best + emit(t, 0);
        back[t * numStates] = from;
      }

      for (let p = 0; p < n; p += 1) {
        // attack(p): continue attacking, start from silence, or change note.
        {
          let best = cost[ATTACK + p];
          let from = ATTACK + p;
          const fromSilence = silencePrev + this.onCost;
          if (fromSilence < best) {
            best = fromSilence;
            from = 0;
          }
          // Enter from a *different* pitch, at least `guard` states away.
          // prefix[i] holds the cheapest stable state at an index < i, so the
          // cheapest at p' ≤ p−guard is prefix[p−guard+1]; suffix[i] holds the
          // cheapest at an index > i, so the cheapest at p' ≥ p+guard is
          // suffix[p+guard−1]. Both lookups are clamped rather than skipped so a
          // note near the edge of the register can still be entered.
          const leftLookup = p - guard + 1;
          if (leftLookup >= 1) {
            const idx = Math.min(leftLookup, n - 1);
            const at = prefixAt[idx];
            const c = prefix[idx];
            if (at >= 0 && Number.isFinite(c) && c + change < best) {
              best = c + change;
              from = STABLE + at;
            }
          }
          const rightLookup = p + guard - 1;
          if (rightLookup <= n - 2) {
            const idx = Math.max(rightLookup, 0);
            const at = suffixAt[idx];
            const c = suffix[idx];
            if (at >= 0 && Number.isFinite(c) && c + change < best) {
              best = c + change;
              from = STABLE + at;
            }
          }
          next[ATTACK + p] = best + emit(t, ATTACK + p);
          back[t * numStates + ATTACK + p] = from;
        }
        // stable(p): continue, or settle out of this pitch's own attack.
        {
          let best = cost[STABLE + p];
          let from = STABLE + p;
          const fromAttack = cost[ATTACK + p] + this.attackCost;
          if (fromAttack < best) {
            best = fromAttack;
            from = ATTACK + p;
          }
          next[STABLE + p] = best + emit(t, STABLE + p);
          back[t * numStates + STABLE + p] = from;
        }
      }
      cost.set(next);
    }

    let endState = 0;
    let endCost = Infinity;
    for (let s = 0; s < numStates; s += 1) {
      if (cost[s] < endCost) {
        endCost = cost[s];
        endState = s;
      }
    }
    const path = new Int32Array(frames);
    path[frames - 1] = endState;
    for (let t = frames - 1; t > 0; t -= 1) {
      path[t - 1] = back[t * numStates + path[t]];
    }
    // Collapse attack/stable into the pitch index they share; the phase mattered
    // only for tolerating deviation, not for where the note is.
    const pitches = new Int32Array(frames);
    for (let t = 0; t < frames; t += 1) {
      const s = path[t];
      pitches[t] = s === 0 ? -1 : s < STABLE ? s - ATTACK : s - STABLE;
    }
    return pitches;
  }

  /** Maximal runs of equal pitch-state index (-1 = silence). */
  private runsOf(pitches: Int32Array, frames: number): Run[] {
    const runs: Run[] = [];
    let start = 0;
    for (let t = 1; t <= frames; t += 1) {
      if (t === frames || pitches[t] !== pitches[start]) {
        runs.push({ start, end: t, state: pitches[start] });
        start = t;
      }
    }
    return runs;
  }

  /**
   * Remove runs shorter than `minNoteSec` (given here as `minFrames` on the
   * track's own grid) without punching holes: a short pitch run between two pitch
   * runs is absorbed into whichever neighbour is closer in pitch (the longer one
   * on a tie), while one adjacent to silence is dropped as noise. Repeats,
   * because absorbing can leave a neighbour newly adjacent to another short run.
   */
  private absorbShortRuns(
    runs: Run[],
    minFrames: number,
    keepShortLoud?: (run: Run) => boolean,
  ): Run[] {
    let work = runs;
    for (let guard = 0; guard < 256; guard += 1) {
      let idx = -1;
      let shortest = Infinity;
      for (let i = 0; i < work.length; i += 1) {
        const r = work[i];
        if (r.state < 0) continue;
        const len = r.end - r.start;
        if (len < minFrames && len < shortest) {
          // WaoN's joint rule: a short run that is LOUD is real staccato.
          if (keepShortLoud?.(r)) continue;
          shortest = len;
          idx = i;
        }
      }
      if (idx < 0) break;

      const prev = work[idx - 1];
      const cur = work[idx];
      const nxt = work[idx + 1];
      const prevOk = prev !== undefined && prev.state >= 0;
      const nextOk = nxt !== undefined && nxt.state >= 0;

      if (!prevOk && !nextOk) {
        cur.state = -1;
        work = this.coalesce(work);
        continue;
      }
      let target: Run;
      if (prevOk && nextOk) {
        const dPrev = Math.abs(prev.state - cur.state);
        const dNext = Math.abs(nxt.state - cur.state);
        if (dPrev < dNext) target = prev;
        else if (dNext < dPrev) target = nxt;
        else target = prev.end - prev.start >= nxt.end - nxt.start ? prev : nxt;
      } else {
        target = prevOk ? prev : nxt;
      }
      cur.state = target.state;
      work = this.coalesce(work);
    }
    return work;
  }

  /** Merge temporally adjacent runs that ended up on the same state. */
  private coalesce(runs: Run[]): Run[] {
    const out: Run[] = [];
    for (const r of runs) {
      const last = out[out.length - 1];
      if (last && last.state === r.state && last.end === r.start) {
        last.end = r.end;
        continue;
      }
      out.push({ ...r });
    }
    return out;
  }

  /**
   * A note's pitch is the median of its voiced contour frames, rounded to a
   * semitone — not the decoded state. The states exist to place boundaries; once
   * placed, the contour itself is the better pitch estimate, and a median is
   * robust to the scoop at the start and the vibrato throughout.
   */
  private medianMidi(
    track: PitchTrack,
    voiced: Uint8Array,
    run: Run,
  ): number | null {
    const vals: number[] = [];
    for (let i = run.start; i < run.end; i += 1) {
      if (voiced[i]) vals.push(track.cents[i]);
    }
    if (!vals.length) return null;
    vals.sort((a, b) => a - b);
    return Math.round(vals[vals.length >> 1] / 100);
  }

  private peakConfidence(track: PitchTrack, run: Run): number {
    let peak = 0;
    for (let i = run.start; i < run.end; i += 1) {
      if (track.confidence[i] > peak) peak = track.confidence[i];
    }
    return peak;
  }
}

/**
 * The clip's own loudness anchor for the WaoN filters: median per-frame energy
 * over voiced frames. Null when there is no energy or nothing voiced, which
 * turns both filters off rather than comparing against a meaningless zero.
 */
function medianVoicedEnergy(
  voiced: Uint8Array,
  frames: number,
  energy: Float32Array | undefined,
): number | null {
  if (!energy || energy.length < frames) return null;
  const vals: number[] = [];
  for (let i = 0; i < frames; i += 1) {
    if (voiced[i]) vals.push(energy[i]);
  }
  if (!vals.length) return null;
  vals.sort((a, b) => a - b);
  return vals[vals.length >> 1];
}

function peakOver(energy: Float32Array, run: { start: number; end: number }): number {
  let peak = 0;
  const to = Math.min(energy.length, run.end);
  for (let i = run.start; i < to; i += 1) if (energy[i] > peak) peak = energy[i];
  return peak;
}

function meanOver(energy: Float32Array, run: { start: number; end: number }): number {
  const to = Math.min(energy.length, run.end);
  if (to <= run.start) return 0;
  let sum = 0;
  for (let i = run.start; i < to; i += 1) sum += energy[i];
  return sum / (to - run.start);
}
