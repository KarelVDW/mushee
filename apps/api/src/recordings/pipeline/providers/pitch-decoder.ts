import type { NoteEventTime } from '@spotify/basic-pitch';

/**
 * Shared decoding utilities used by every per-frame-activation provider
 * (CREPE, …). Each provider runs its own model to produce a
 * `[frames, numBins]` activation matrix; everything from there — Viterbi
 * smoothing, sub-bin pitch refinement, run segmentation — is provider-agnostic
 * and lives here.
 */

export interface ViterbiOptions {
  /** Number of pitch bins per frame (= activation row length). */
  numBins: number;
  /** Standard deviation (in bins) of the Gaussian transition prior. Models
   *  with denser bin spacing (smaller cents/bin) want a smaller σ in bins to
   *  keep the cents-equivalent σ roughly constant across providers. */
  sigmaBins: number;
  /** Truncate the transition kernel beyond ±band bins. Controls per-frame cost
   *  (O(numBins · band) vs O(numBins²)). Pick ≥ 3·sigmaBins. */
  bandBins: number;
  /**
   * Floor (in log-probability nats, negative) on the transition prior within
   * the band — a Gaussian+uniform MIXTURE. The pure Gaussian makes a large
   * interval quadratically expensive, so when reverb keeps the previous
   * note's tail alive the path clings to it for hundreds of ms and eats the
   * next note's onset (arpeggios under reverb collapse). With a floor, any
   * in-band jump costs at most `-jumpLogFloor` nats, so a few frames of
   * evidence for the new pitch flips the path. Omit for the pure Gaussian.
   */
  jumpLogFloor?: number;
}

/**
 * Viterbi decode over a per-frame pitch-activation matrix. Returns the most
 * likely bin index per frame under a band-limited Gaussian transition prior.
 * Mirrors marl/crepe's `to_viterbi_cents` decode step (minus the local-average
 * cents lift, done separately by `localCentsFromPath`).
 */
export function viterbi(
  activations: Float32Array,
  frames: number,
  opts: ViterbiOptions,
): Int16Array {
  const { numBins, sigmaBins, bandBins } = opts;
  const path = new Int16Array(frames);
  if (frames === 0) return path;

  const kernelSize = 2 * bandBins + 1;
  const logTrans = new Float32Array(kernelSize);
  const twoSigmaSq = 2 * sigmaBins * sigmaBins;
  const floor = opts.jumpLogFloor ?? -Infinity;
  for (let d = -bandBins; d <= bandBins; d++) {
    logTrans[d + bandBins] = Math.max(-(d * d) / twoSigmaSq, floor);
  }

  const logProb = new Float32Array(frames * numBins);
  const psi = new Int16Array(frames * numBins);

  // First frame: log salience under a uniform prior (constant absorbed).
  for (let b = 0; b < numBins; b++) {
    logProb[b] = Math.log(activations[b] + 1e-15);
  }

  for (let t = 1; t < frames; t++) {
    const offCur = t * numBins;
    const offPrev = offCur - numBins;
    for (let bCur = 0; bCur < numBins; bCur++) {
      const lo = Math.max(0, bCur - bandBins);
      const hi = Math.min(numBins - 1, bCur + bandBins);
      let bestScore = -Infinity;
      let bestPrev = bCur;
      for (let bPrev = lo; bPrev <= hi; bPrev++) {
        const s =
          logProb[offPrev + bPrev] + logTrans[bCur - bPrev + bandBins];
        if (s > bestScore) {
          bestScore = s;
          bestPrev = bPrev;
        }
      }
      logProb[offCur + bCur] =
        bestScore + Math.log(activations[offCur + bCur] + 1e-15);
      psi[offCur + bCur] = bestPrev;
    }
  }

  let bestEnd = 0;
  let bestEndScore = -Infinity;
  const lastOff = (frames - 1) * numBins;
  for (let b = 0; b < numBins; b++) {
    const s = logProb[lastOff + b];
    if (s > bestEndScore) {
      bestEndScore = s;
      bestEnd = b;
    }
  }
  path[frames - 1] = bestEnd;
  for (let t = frames - 2; t >= 0; t--) {
    path[t] = psi[(t + 1) * numBins + path[t + 1]];
  }
  return path;
}

/**
 * For each frame, weighted mean of cents over the ±halfWidth bins around the
 * Viterbi path's chosen bin. Lifts the integer-bin pitch trajectory to
 * sub-bin precision without smearing across unrelated peaks (which a global
 * weighted mean would do).
 */
export function localCentsFromPath(
  activations: Float32Array,
  path: Int16Array,
  frames: number,
  centMap: Float32Array,
  numBins: number,
  halfWidth: number,
): Float32Array {
  const cents = new Float32Array(frames);
  for (let t = 0; t < frames; t++) {
    const center = path[t];
    const lo = Math.max(0, center - halfWidth);
    const hi = Math.min(numBins - 1, center + halfWidth);
    const offset = t * numBins;
    let weighted = 0;
    let total = 0;
    for (let b = lo; b <= hi; b++) {
      const a = activations[offset + b];
      weighted += a * centMap[b];
      total += a;
    }
    cents[t] = total > 0 ? weighted / total : centMap[center];
  }
  return cents;
}

export interface SegmentOptions {
  /** Hop length in samples. */
  hopSize: number;
  /** Sample rate the per-frame outputs were computed at. */
  sampleRate: number;
  /** Frames with peak activation below this are treated as unvoiced. */
  confidenceThreshold: number;
  /** Hz cutoffs — voiced frames outside this band are dropped. */
  minFreqHz: number;
  maxFreqHz: number;
  /** Minimum consecutive in-tolerance frames required to commit a note. */
  minFramesPerNote: number;
  /** Cents window within which a frame counts as "same pitch" as the run's median. */
  pitchBinToleranceCents: number;
  /**
   * Segmentation strategy:
   *  - 'median' (default): a run continues while frames stay within
   *    pitchBinToleranceCents of the run's running median (legacy).
   *  - 'semitone': round each frame to its nearest semitone, median-smooth the
   *    per-frame pitch, then merge equal-semitone runs. Boundaries land on
   *    semitone changes, which tracks discrete sung/whistled notes (and a
   *    human's note-level hearing) more closely than median drift.
   */
  mode?: 'median' | 'semitone';
  /**
   * Semitone mode only: half-window (in frames) of the median smoother applied
   * to the per-frame semitone track before merging runs. Larger absorbs brief
   * pitch excursions / transition frames (fewer spurious notes, steadier
   * boundaries) at the cost of blurring very short notes. Default 1 (3-frame).
   */
  smoothFrames?: number;
  /**
   * Semitone mode only: estimate the clip's systematic tuning offset (singers
   * rarely sit at A=440) as the circular mean of the per-frame cents modulo a
   * semitone, then quantize RELATIVE to it — what a human transcriber does by
   * ear. Tested and OFF by default: ground-truth pitch is absolute (A=440), so
   * re-centering to the singer's tuning shifts quantization away from the
   * reference and increases disagreement — the ±1 errors are genuine drift
   * around A=440, not a fixable offset. Enable with `true` only for
   * tuning-relative scoring.
   */
  tuningCorrect?: boolean;
}

/**
 * Segment a per-frame `cents` / `confidence` stream into note events. Runs of
 * voiced frames whose pitch sits within `pitchBinToleranceCents` of the
 * running median become single notes; voiced frames outside the band end the
 * current run.
 */
export function segmentNotes(
  cents: Float32Array,
  confidence: Float32Array,
  frames: number,
  opts: SegmentOptions,
): NoteEventTime[] {
  if (opts.mode === 'semitone') {
    return segmentNotesBySemitone(cents, confidence, frames, opts);
  }
  const notes: NoteEventTime[] = [];
  let runStart = -1;
  let runCents: number[] = [];
  let runMaxConf = 0;

  const finalize = (endIndex: number): void => {
    if (runStart < 0 || runCents.length < opts.minFramesPerNote) {
      runStart = -1;
      runCents = [];
      runMaxConf = 0;
      return;
    }
    const medianCents = median(runCents);
    const midi = Math.round(medianCents / 100);
    notes.push({
      startTimeSeconds: (runStart * opts.hopSize) / opts.sampleRate,
      durationSeconds: ((endIndex - runStart) * opts.hopSize) / opts.sampleRate,
      pitchMidi: midi,
      amplitude: runMaxConf,
    });
    runStart = -1;
    runCents = [];
    runMaxConf = 0;
  };

  for (let i = 0; i < frames; i++) {
    const conf = confidence[i];
    const c = cents[i];
    const hz = a4CentsToHz(c);
    const voiced =
      conf >= opts.confidenceThreshold &&
      hz >= opts.minFreqHz &&
      hz <= opts.maxFreqHz;
    if (!voiced) {
      finalize(i);
      continue;
    }
    if (runStart < 0) {
      runStart = i;
      runCents = [c];
      runMaxConf = conf;
      continue;
    }
    const runMedian = median(runCents);
    if (Math.abs(c - runMedian) > opts.pitchBinToleranceCents) {
      finalize(i);
      runStart = i;
      runCents = [c];
      runMaxConf = conf;
    } else {
      runCents.push(c);
      if (conf > runMaxConf) runMaxConf = conf;
    }
  }
  finalize(frames);
  return notes;
}

/**
 * Estimate a clip's systematic tuning offset in cents ([-50, 50]) as the
 * circular mean of every voiced frame's cents modulo 100. Circular (period 100)
 * so it's robust to wraparound near the semitone boundary; returns 0 when there
 * is no voiced frame. A consistently flat/sharp singer lands at a nonzero
 * offset; in-tune (A=440) material lands at ~0, making correction a no-op.
 */
function estimateTuningOffset(
  cents: Float32Array,
  frames: number,
  isVoiced: (i: number) => boolean,
): number {
  let sumSin = 0;
  let sumCos = 0;
  let n = 0;
  const twoPiOver100 = (2 * Math.PI) / 100;
  for (let i = 0; i < frames; i++) {
    if (!isVoiced(i)) continue;
    let r = cents[i] % 100;
    if (r < 0) r += 100;
    const a = r * twoPiOver100;
    sumSin += Math.sin(a);
    sumCos += Math.cos(a);
    n += 1;
  }
  if (n === 0) return 0;
  let off = Math.atan2(sumSin / n, sumCos / n) / twoPiOver100; // [-50, 50]
  if (off > 50) off -= 100;
  if (off < -50) off += 100;
  return off;
}

/**
 * Alternative segmenter: quantize each voiced frame to its nearest semitone,
 * median-smooth the per-frame semitone track to kill single-frame glitches, then
 * emit a note per maximal run of equal semitone. Note boundaries therefore fall
 * exactly on semitone changes — closer to how discrete notes are sung/whistled
 * (and heard) than the running-median drift, which can blur a step or fragment
 * vibrato. Voicing/band gating and minFramesPerNote match `segmentNotes`.
 */
export function segmentNotesBySemitone(
  cents: Float32Array,
  confidence: Float32Array,
  frames: number,
  opts: SegmentOptions,
): NoteEventTime[] {
  const isVoiced = (i: number): boolean => {
    const hz = a4CentsToHz(cents[i]);
    return (
      confidence[i] >= opts.confidenceThreshold &&
      hz >= opts.minFreqHz &&
      hz <= opts.maxFreqHz
    );
  };

  // Tuning offset (cents in [-50,50]): circular mean of voiced cents modulo a
  // semitone. Quantizing relative to it re-centers a consistently flat/sharp
  // singer so drift no longer flips notes across the semitone boundary.
  const delta = opts.tuningCorrect === true ? estimateTuningOffset(cents, frames, isVoiced) : 0;

  // Per-frame nearest semitone (tuning-corrected), or -1 when unvoiced / out of band.
  const raw = new Int16Array(frames);
  for (let i = 0; i < frames; i++) {
    raw[i] = isVoiced(i) ? Math.round((cents[i] - delta) / 100) : -1;
  }

  // Median smoothing over a (2*half+1)-frame window of voiced frames (an
  // unvoiced neighbor is replaced by the center so a lone voiced frame between
  // gaps survives rather than being zeroed). Larger half absorbs brief
  // transition/vibrato excursions before runs are merged.
  const half = Math.max(1, opts.smoothFrames ?? 1);
  const sm = new Int16Array(frames);
  for (let i = 0; i < frames; i++) {
    const b = raw[i];
    if (b < 0) {
      sm[i] = -1;
      continue;
    }
    const window: number[] = [];
    for (let k = -half; k <= half; k++) {
      const v = raw[Math.min(frames - 1, Math.max(0, i + k))];
      window.push(v < 0 ? b : v);
    }
    window.sort((x, y) => x - y);
    sm[i] = window[window.length >> 1];
  }

  const notes: NoteEventTime[] = [];
  let runStart = -1;
  let runMidi = -2;
  let runMaxConf = 0;
  const finalize = (endIndex: number): void => {
    if (runStart >= 0 && runMidi >= 0 && endIndex - runStart >= opts.minFramesPerNote) {
      notes.push({
        startTimeSeconds: (runStart * opts.hopSize) / opts.sampleRate,
        durationSeconds: ((endIndex - runStart) * opts.hopSize) / opts.sampleRate,
        pitchMidi: runMidi,
        amplitude: runMaxConf,
      });
    }
    runStart = -1;
    runMidi = -2;
    runMaxConf = 0;
  };

  for (let i = 0; i < frames; i++) {
    const m = sm[i];
    if (m < 0) {
      finalize(i);
      continue;
    }
    if (m !== runMidi) {
      finalize(i);
      runStart = i;
      runMidi = m;
      runMaxConf = confidence[i];
    } else if (confidence[i] > runMaxConf) {
      runMaxConf = confidence[i];
    }
  }
  finalize(frames);
  return notes;
}

/** Per-frame zero-mean / unit-variance normalization, matching what most
 *  pitch CNNs (CREPE, etc.) expect on raw windows. */
export function normalizeFrame(window: Float32Array): Float32Array {
  let mean = 0;
  for (let i = 0; i < window.length; i++) mean += window[i];
  mean /= window.length;
  let sq = 0;
  for (let i = 0; i < window.length; i++) {
    const d = window[i] - mean;
    sq += d * d;
  }
  const std = Math.sqrt(sq / window.length) || 1;
  const out = new Float32Array(window.length);
  for (let i = 0; i < window.length; i++) {
    out[i] = (window[i] - mean) / std;
  }
  return out;
}

function a4CentsToHz(cents: number): number {
  return 440 * Math.pow(2, (cents - 6900) / 1200);
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
}
