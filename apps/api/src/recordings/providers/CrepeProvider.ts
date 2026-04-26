import { Logger } from '@nestjs/common';
import type { NoteEventTime } from '@spotify/basic-pitch';
import * as tf from '@tensorflow/tfjs';

import { CrepeModelLoader } from './CrepeModelLoader';
import type { PitchProvider } from './PitchProvider';

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

/**
 * Monophonic pitch transcriber backed by a real CREPE model loaded via TF.js.
 * Resamples audio to 16 kHz, slides 1024-sample windows, runs the CNN to get
 * per-frame pitch + confidence, then segments runs of stable pitch into
 * `NoteEventTime[]`.
 *
 * Drop-in alternative to `BasicPitchProvider` via the `PitchProvider`
 * interface — switch with `PITCH_PROVIDER=crepe`.
 */
export class CrepeProvider implements PitchProvider {
  readonly name = 'crepe';
  readonly sampleRate = SAMPLE_RATE;

  private readonly logger = new Logger(CrepeProvider.name);
  private readonly loader: CrepeModelLoader;
  private readonly centMapping: Float32Array = buildCentMapping();

  constructor(modelDir: string) {
    this.loader = new CrepeModelLoader(modelDir);
    this.logger.log(`CREPE model dir: ${modelDir}`);
  }

  async init(): Promise<void> {
    await this.loader.load();
  }

  async transcribe(
    samples: Float32Array,
    onProgress?: (rawNotes: NoteEventTime[]) => void,
  ): Promise<NoteEventTime[]> {
    const model = await this.loader.load();
    const numFrames = Math.max(
      0,
      Math.floor((samples.length - FRAME_SIZE) / HOP_SIZE) + 1,
    );
    if (numFrames === 0) {
      onProgress?.([]);
      return [];
    }

    const cents = new Float32Array(numFrames);
    const confidence = new Float32Array(numFrames);

    for (let batchStart = 0; batchStart < numFrames; batchStart += INFERENCE_BATCH) {
      const batchEnd = Math.min(batchStart + INFERENCE_BATCH, numFrames);
      const batchCount = batchEnd - batchStart;
      const { centsBatch, confBatch } = tf.tidy(() => {
        const flat = new Float32Array(batchCount * FRAME_SIZE);
        for (let f = 0; f < batchCount; f++) {
          const start = (batchStart + f) * HOP_SIZE;
          const window = samples.subarray(start, start + FRAME_SIZE);
          const normalized = normalizeFrame(window);
          flat.set(normalized, f * FRAME_SIZE);
        }
        const input = tf.tensor2d(flat, [batchCount, FRAME_SIZE]);
        const activation = model.predict(input) as tf.Tensor2D; // [batchCount, 360]
        const conf = activation.max(1); // [batchCount]
        // Build cent mapping inside the tidy — disposed with the rest at exit.
        const centMap = tf.tensor1d(this.centMapping);
        // Local weighted average of cent bins, weighted by activation.
        const centsPerFrame = activation
          .mul<tf.Tensor2D>(centMap.expandDims(0))
          .sum(1)
          .div(activation.sum(1));
        return {
          centsBatch: centsPerFrame.dataSync().slice() as Float32Array,
          confBatch: conf.dataSync().slice() as Float32Array,
        };
      });
      cents.set(centsBatch, batchStart);
      confidence.set(confBatch, batchStart);
    }

    const notes = this.segment(cents, confidence);
    onProgress?.(notes);
    return notes;
  }

  private segment(
    cents: Float32Array,
    confidence: Float32Array,
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

    for (let i = 0; i < cents.length; i++) {
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
    finalize(cents.length);
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
