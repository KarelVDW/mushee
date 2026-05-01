import { Logger } from '@nestjs/common';
import type { NoteEventTime } from '@spotify/basic-pitch';
import * as tf from '@tensorflow/tfjs';

import { CrepeModelLoader } from './CrepeModelLoader';
import type { PitchProvider, PitchSession } from './PitchProvider';

/** CREPE was trained on 16 kHz mono audio. */
const SAMPLE_RATE = 16000;
/** Per-frame window the CREPE network expects. */
const FRAME_SIZE = 1024;
/** Hop between frame starts. 320 = 20 ms; coarser than CREPE's default 10 ms,
 *  but a quarter of the inference cost and plenty for note-level transcription. */
const HOP_SIZE = 320;
/** CREPE outputs 360 sigmoid units mapped linearly across 7180 cents,
 *  offset so that bin 0 ≈ 31.7 Hz (~C1). */
const CREPE_BINS = 360;
const CREPE_CENTS_RANGE = 7180;
/** Cents value of bin 0 — comes straight from the upstream demo. */
const CREPE_CENTS_OFFSET = 1997.3794084376191;
/** Frames with peak activation below this are treated as unvoiced. */
const CONFIDENCE_THRESHOLD = 0.5;
/** Hz cutoffs matching the basic-pitch provider — roughly vocal range. */
const MIN_FREQ_HZ = 65;
const MAX_FREQ_HZ = 1100;
/** Min consecutive in-tolerance frames required to commit a note. */
const MIN_FRAMES_PER_NOTE = 4; // ≈ 80 ms at HOP_SIZE = 320
/** Cents window within which a frame counts as "same pitch" as the run's median. */
const PITCH_BIN_TOLERANCE_CENTS = 50;
/** Inference batch size (frames per model.predict call). Larger = better
 *  throughput, more peak memory. */
const INFERENCE_BATCH = 256;
/** Half-width in bins of the local weighted-mean window, centered on the
 *  Viterbi path bin. 4 → 9-bin window matches marl/crepe's reference
 *  `to_local_average_cents`. */
const LOCAL_AVG_HALF_WIDTH = 4;
/** Standard deviation (in bins) of the Viterbi transition Gaussian. 12 bins
 *  ≈ 240 cents; movements within ~2 semitones are nearly free, larger jumps
 *  are exponentially penalized. Matches marl/crepe's `to_viterbi_cents`. */
const VITERBI_SIGMA_BINS = 12;
/** Truncate the Viterbi transition kernel beyond ±4σ — contributions are
 *  < 3.4e-4 there and the salience term dominates. Cuts per-frame work from
 *  O(BINS²) to O(BINS · BAND). */
const VITERBI_BAND_BINS = VITERBI_SIGMA_BINS * 4;
/** Trailing cached frames recomputed every pass. ffmpeg's resampler tail
 *  produces slightly different output samples when given a longer input, so
 *  the very last cached frames are tentative until the next pass confirms
 *  them. 5 frames ≈ 100 ms — generous for a ~1 ms swr boundary. */
const RECOMPUTE_TAIL_FRAMES = 5;

/**
 * Per-recording state for the CREPE provider. Holds cached per-frame
 * activations and peak-confidence values so subsequent `transcribe` calls
 * within the same session only run inference on new frames (plus a small
 * tail recompute), instead of re-processing the entire growing audio buffer.
 */
class CrepeSession implements PitchSession {
  /** Number of frames whose `activations` and `confidence` slots are populated. */
  cachedFrames = 0;
  /** [cachedFrames * CREPE_BINS] flat row-major activation matrix. */
  activations: Float32Array = new Float32Array(0);
  /** [cachedFrames] per-frame max activation (used for voicing decisions). */
  confidence: Float32Array = new Float32Array(0);
}

/**
 * Monophonic pitch transcriber backed by a real CREPE model loaded via TF.js.
 * Resamples audio to 16 kHz, slides 1024-sample windows, runs the CNN to get
 * per-frame activations, decodes a smooth pitch trajectory via Viterbi, then
 * segments runs of stable pitch into `NoteEventTime[]`.
 *
 * Drop-in alternative to `BasicPitchProvider` via the `PitchProvider`
 * interface — switch with `PITCH_PROVIDER=crepe`.
 */
export class CrepeProvider implements PitchProvider {
  readonly name: string;
  readonly sampleRate = SAMPLE_RATE;
  // CREPE per-frame normalizes the input to zero-mean unit-variance, so
  // ffmpeg loudnorm is redundant — and dropping it makes the decoded sample
  // prefix stable across passes, which the session cache below requires.
  readonly normalizeLoudness = false;

  private readonly logger = new Logger(CrepeProvider.name);
  private readonly loader: CrepeModelLoader;
  private readonly centMapping: Float32Array = buildCentMapping();

  constructor(modelDir: string, name = 'crepe') {
    this.name = name;
    this.loader = new CrepeModelLoader(modelDir);
    this.logger.log(`${name} model dir: ${modelDir}`);
  }

  async init(): Promise<void> {
    await this.loader.load();
  }

  createSession(): CrepeSession {
    return new CrepeSession();
  }

  async transcribe(
    samples: Float32Array,
    onProgress?: (rawNotes: NoteEventTime[]) => void,
    session?: PitchSession,
  ): Promise<NoteEventTime[]> {
    const model = await this.loader.load();
    const sess =
      session instanceof CrepeSession ? session : new CrepeSession();

    const numFrames = Math.max(
      0,
      Math.floor((samples.length - FRAME_SIZE) / HOP_SIZE) + 1,
    );
    if (numFrames === 0) {
      onProgress?.([]);
      return [];
    }

    // Defensive: if the buffer somehow shrank (shouldn't with prefix-stable
    // decoding) start fresh — using stale tail cells would silently corrupt
    // the Viterbi pass.
    if (numFrames < sess.cachedFrames) {
      sess.cachedFrames = 0;
      sess.activations = new Float32Array(0);
      sess.confidence = new Float32Array(0);
    }

    // Grow the cache buffers if we have new frames to fill in.
    if (numFrames * CREPE_BINS > sess.activations.length) {
      const grownAct = new Float32Array(numFrames * CREPE_BINS);
      grownAct.set(sess.activations);
      sess.activations = grownAct;
      const grownConf = new Float32Array(numFrames);
      grownConf.set(sess.confidence);
      sess.confidence = grownConf;
    }

    // Compute frames in [recomputeStart, numFrames). Earlier frames are kept
    // verbatim from the cache.
    const recomputeStart = Math.max(
      0,
      Math.min(sess.cachedFrames, numFrames) - RECOMPUTE_TAIL_FRAMES,
    );

    for (
      let batchStart = recomputeStart;
      batchStart < numFrames;
      batchStart += INFERENCE_BATCH
    ) {
      const batchEnd = Math.min(batchStart + INFERENCE_BATCH, numFrames);
      const batchCount = batchEnd - batchStart;
      const { actBatch, confBatch } = tf.tidy(() => {
        const flat = new Float32Array(batchCount * FRAME_SIZE);
        for (let f = 0; f < batchCount; f++) {
          const start = (batchStart + f) * HOP_SIZE;
          const window = samples.subarray(start, start + FRAME_SIZE);
          flat.set(normalizeFrame(window), f * FRAME_SIZE);
        }
        const input = tf.tensor2d(flat, [batchCount, FRAME_SIZE]);
        const activation = model.predict(input) as tf.Tensor2D; // [batchCount, 360]
        const conf = activation.max(1); // [batchCount]
        return {
          actBatch: activation.dataSync().slice() as Float32Array,
          confBatch: conf.dataSync().slice() as Float32Array,
        };
      });
      sess.activations.set(actBatch, batchStart * CREPE_BINS);
      sess.confidence.set(confBatch, batchStart);
    }
    sess.cachedFrames = numFrames;

    // Viterbi smooths the per-frame argmax into a coherent bin trajectory,
    // dropping spurious octave/harmonic flips. Local-5 weighted mean around
    // each Viterbi bin then lifts the result to sub-bin precision.
    const path = viterbi(sess.activations, numFrames);
    const cents = localCentsFromPath(
      sess.activations,
      path,
      numFrames,
      this.centMapping,
    );

    const notes = this.segment(cents, sess.confidence, numFrames);
    onProgress?.(notes);
    return notes;
  }

  private segment(
    cents: Float32Array,
    confidence: Float32Array,
    numFrames: number,
  ): NoteEventTime[] {
    const notes: NoteEventTime[] = [];
    let runStart = -1;
    let runCents: number[] = [];
    let runMaxConf = 0;

    const finalize = (endIndex: number): void => {
      if (runStart < 0 || runCents.length < MIN_FRAMES_PER_NOTE) {
        runStart = -1;
        runCents = [];
        runMaxConf = 0;
        return;
      }
      const medianCents = median(runCents);
      const midi = Math.round(medianCents / 100);
      notes.push({
        startTimeSeconds: (runStart * HOP_SIZE) / SAMPLE_RATE,
        durationSeconds: ((endIndex - runStart) * HOP_SIZE) / SAMPLE_RATE,
        pitchMidi: midi,
        amplitude: runMaxConf,
      });
      runStart = -1;
      runCents = [];
      runMaxConf = 0;
    };

    for (let i = 0; i < numFrames; i++) {
      const conf = confidence[i];
      const c = cents[i];
      const hz = a4CentsToHz(c);
      const voiced =
        conf >= CONFIDENCE_THRESHOLD && hz >= MIN_FREQ_HZ && hz <= MAX_FREQ_HZ;
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
      if (Math.abs(c - runMedian) > PITCH_BIN_TOLERANCE_CENTS) {
        finalize(i);
        runStart = i;
        runCents = [c];
        runMaxConf = conf;
      } else {
        runCents.push(c);
        if (conf > runMaxConf) runMaxConf = conf;
      }
    }
    finalize(numFrames);
    return notes;
  }
}

/**
 * CREPE bin index → absolute MIDI cents (A4 = 6900). CREPE outputs cents
 * referenced to 10 Hz; we shift to A4-reference so downstream `cents/100`
 * gives the MIDI note number directly.
 */
function buildCentMapping(): Float32Array {
  const arr = new Float32Array(CREPE_BINS);
  const offset = 6900 + 1200 * Math.log2(10 / 440);
  for (let i = 0; i < CREPE_BINS; i++) {
    const crepeCents =
      CREPE_CENTS_OFFSET + (CREPE_CENTS_RANGE * i) / (CREPE_BINS - 1);
    arr[i] = crepeCents + offset;
  }
  return arr;
}

/** Per-frame zero-mean / unit-variance normalization, matching CREPE inference. */
function normalizeFrame(window: Float32Array): Float32Array {
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

/**
 * Viterbi decode over a CREPE activation matrix. Returns the most-likely bin
 * per frame under a band-limited Gaussian transition prior with σ = 12 bins.
 *
 * Equivalent to marl/crepe's `to_viterbi_cents` decode step (minus the
 * subsequent local-average cents lift, which we do separately so we can run
 * it on the cached activation matrix).
 */
function viterbi(activations: Float32Array, frames: number): Int16Array {
  const path = new Int16Array(frames);
  if (frames === 0) return path;

  // Pre-compute log of the Gaussian transition kernel for ±BAND bins.
  const kernelSize = 2 * VITERBI_BAND_BINS + 1;
  const logTrans = new Float32Array(kernelSize);
  const twoSigmaSq = 2 * VITERBI_SIGMA_BINS * VITERBI_SIGMA_BINS;
  for (let d = -VITERBI_BAND_BINS; d <= VITERBI_BAND_BINS; d++) {
    logTrans[d + VITERBI_BAND_BINS] = -(d * d) / twoSigmaSq;
  }

  // Forward pass tables.
  const logProb = new Float32Array(frames * CREPE_BINS);
  const psi = new Int16Array(frames * CREPE_BINS);

  // First frame: log salience, uniform prior absorbed as a constant.
  for (let b = 0; b < CREPE_BINS; b++) {
    logProb[b] = Math.log(activations[b] + 1e-15);
  }

  for (let t = 1; t < frames; t++) {
    const offCur = t * CREPE_BINS;
    const offPrev = offCur - CREPE_BINS;
    for (let bCur = 0; bCur < CREPE_BINS; bCur++) {
      const lo = Math.max(0, bCur - VITERBI_BAND_BINS);
      const hi = Math.min(CREPE_BINS - 1, bCur + VITERBI_BAND_BINS);
      let bestScore = -Infinity;
      let bestPrev = bCur;
      for (let bPrev = lo; bPrev <= hi; bPrev++) {
        const s =
          logProb[offPrev + bPrev] +
          logTrans[bCur - bPrev + VITERBI_BAND_BINS];
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

  // Backtrack from the highest-scoring final-frame bin.
  let bestEnd = 0;
  let bestEndScore = -Infinity;
  const lastOff = (frames - 1) * CREPE_BINS;
  for (let b = 0; b < CREPE_BINS; b++) {
    const s = logProb[lastOff + b];
    if (s > bestEndScore) {
      bestEndScore = s;
      bestEnd = b;
    }
  }
  path[frames - 1] = bestEnd;
  for (let t = frames - 2; t >= 0; t--) {
    path[t] = psi[(t + 1) * CREPE_BINS + path[t + 1]];
  }
  return path;
}

/**
 * For each frame, weighted mean of cents over the ±LOCAL_AVG_HALF_WIDTH
 * bins around the Viterbi path's chosen bin. Lifts the integer-bin pitch
 * trajectory to sub-bin precision without smearing across unrelated peaks
 * (which a global weighted mean would do).
 */
function localCentsFromPath(
  activations: Float32Array,
  path: Int16Array,
  frames: number,
  centMap: Float32Array,
): Float32Array {
  const cents = new Float32Array(frames);
  for (let t = 0; t < frames; t++) {
    const center = path[t];
    const lo = Math.max(0, center - LOCAL_AVG_HALF_WIDTH);
    const hi = Math.min(CREPE_BINS - 1, center + LOCAL_AVG_HALF_WIDTH);
    const offset = t * CREPE_BINS;
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
