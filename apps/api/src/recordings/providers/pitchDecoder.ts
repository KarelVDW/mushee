import type { NoteEventTime } from '@spotify/basic-pitch';

/**
 * Shared decoding utilities used by every per-frame-activation provider
 * (CREPE, PESTO, …). Each provider runs its own model to produce a
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
  for (let d = -bandBins; d <= bandBins; d++) {
    logTrans[d + bandBins] = -(d * d) / twoSigmaSq;
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

/** Per-frame zero-mean / unit-variance normalization, matching what most
 *  pitch CNNs (CREPE, etc.) expect on raw windows. PESTO does this internally
 *  inside the ONNX graph so it doesn't call this. */
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
