import { Logger } from '@nestjs/common';
import type { NoteEventTime } from '@spotify/basic-pitch';

import type { ModelBackend } from './model-backend';
import {
  localCentsFromPath,
  normalizeFrame,
  segmentNotes,
  type SegmentOptions,
  viterbi,
  type ViterbiOptions,
} from './pitch-decoder';
import type {
  PitchProvider,
  PitchSession,
  PitchTranscribeOptions,
} from './pitch-provider';

/** CREPE was trained on 16 kHz mono audio. */
const SAMPLE_RATE = 16000;
/** Per-frame window the CREPE network expects. */
const FRAME_SIZE = 1024;
/** Hop between frame starts. 320 = 20 ms; coarser than CREPE's default 10 ms,
 *  but a quarter of the inference cost and plenty for note-level transcription. */
const HOP_SIZE = 320;
/** CREPE outputs 360 sigmoid units mapped linearly across 7180 cents,
 *  offset so that bin 0 ≈ 31.7 Hz (~C1). */
const NUM_BINS = 360;
const CREPE_CENTS_RANGE = 7180;
/** Cents value of bin 0 — comes straight from the upstream demo. */
const CREPE_CENTS_OFFSET = 1997.3794084376191;
/** Inference batch size (frames per model.predict call). Larger = better
 *  throughput, more peak memory. */
const INFERENCE_BATCH = 256;
/** Half-width in bins of the local weighted-mean window, centered on the
 *  Viterbi path bin. 4 → 9-bin window matches marl/crepe's reference. */
const LOCAL_AVG_HALF_WIDTH = 4;
/** σ in bins for the Viterbi transition kernel. 12 bins ≈ 240 cents at CREPE's
 *  ~20 cents/bin spacing — matches marl/crepe's `to_viterbi_cents`. */
const VITERBI_SIGMA_BINS = 12;
/** ±band beyond which the transition kernel is truncated. 4·σ keeps us well
 *  within the tail (transitions there contribute < 3.4e-4). */
const VITERBI_BAND_BINS = VITERBI_SIGMA_BINS * 4;
/** Trailing cached frames recomputed every pass. ffmpeg's resampler tail
 *  produces slightly different output samples when given a longer input, so
 *  the very last cached frames are tentative until the next pass confirms them. */
const RECOMPUTE_TAIL_FRAMES = 5;

/**
 * Jump-cost floor for the transition prior (see ViterbiOptions.jumpLogFloor),
 * in nats — e.g. -2.5 lets the path leave a reverb tail after a few frames of
 * evidence for the new note. OFF BY DEFAULT: the 2026-07 adverse eval measured
 * it within noise on the synthetic matrix (-0.001 overall) and mildly negative
 * on real reverberant singing — the reverb-tail-tracking theory it encodes is
 * not what actually limits reverb recall. Set RECORDING_VITERBI_JUMP_FLOOR to
 * a negative number to experiment.
 */
const JUMP_FLOOR_ENV = process.env.RECORDING_VITERBI_JUMP_FLOOR;
const VITERBI_JUMP_FLOOR =
  JUMP_FLOOR_ENV !== undefined && JUMP_FLOOR_ENV !== '' && Number.isFinite(Number(JUMP_FLOOR_ENV))
    ? Number(JUMP_FLOOR_ENV)
    : undefined;

const VITERBI_OPTS: ViterbiOptions = {
  numBins: NUM_BINS,
  sigmaBins: VITERBI_SIGMA_BINS,
  bandBins: VITERBI_BAND_BINS,
  jumpLogFloor: VITERBI_JUMP_FLOOR,
};

const SEGMENT_OPTS: SegmentOptions = {
  hopSize: HOP_SIZE,
  sampleRate: SAMPLE_RATE,
  confidenceThreshold: 0.5,
  minFreqHz: 65,
  maxFreqHz: 1100,
  minFramesPerNote: 4, // ≈ 80 ms at HOP_SIZE = 320
  pitchBinToleranceCents: 50,
  // Semitone-merge segmentation with temporal smoothing: boundaries fall on
  // semitone changes and brief transition/vibrato frames are absorbed. Validated
  // to lift real sung/hummed F1 markedly while holding the synthetic-instrument
  // corpus; far steadier than running-median on expressive monophonic input.
  mode: 'semitone',
  smoothFrames: 4,
};

/** Per-recording state for the CREPE provider. */
class CrepeSession implements PitchSession {
  cachedFrames = 0;
  activations: Float32Array = new Float32Array(0);
  confidence: Float32Array = new Float32Array(0);
}

/**
 * Monophonic pitch transcriber backed by a real CREPE model loaded via TF.js.
 * Resamples audio to 16 kHz, slides 1024-sample windows, runs the CNN to get
 * per-frame activations, decodes a smooth pitch trajectory via Viterbi, then
 * segments runs of stable pitch into `NoteEventTime[]`.
 */
export class CrepeProvider implements PitchProvider {
  readonly name: string;
  readonly sampleRate = SAMPLE_RATE;
  readonly normalizeLoudness = false;
  readonly hasNativeOnsets = false;
  // Caches CNN activations across passes in `CrepeSession`, keyed on absolute
  // frame index, so the pipeline must feed it the whole growing buffer (never a
  // sliding window) and the cache makes re-passing incremental.
  readonly cachesAcrossPasses = true;
  // Never windowed (fed the whole buffer), so no alignment constraint applies.
  readonly windowAlignSamples = 1;

  private readonly logger = new Logger(CrepeProvider.name);
  private readonly centMapping: Float32Array = buildCentMapping();

  constructor(
    private readonly backend: ModelBackend,
    name = 'crepe',
  ) {
    this.name = name;
    this.logger.log(`${name} provider ready`);
  }

  async init(): Promise<void> {
    await this.backend.warm('crepe-tiny');
  }

  createSession(): CrepeSession {
    return new CrepeSession();
  }

  async transcribe(
    samples: Float32Array,
    options?: PitchTranscribeOptions,
    onProgress?: (rawNotes: NoteEventTime[]) => void,
    session?: PitchSession,
  ): Promise<NoteEventTime[]> {
    const segmentOpts: SegmentOptions = {
      ...SEGMENT_OPTS,
      ...(options?.minFreqHz !== undefined && { minFreqHz: options.minFreqHz }),
      ...(options?.maxFreqHz !== undefined && { maxFreqHz: options.maxFreqHz }),
      ...(options?.confidenceThreshold !== undefined && {
        confidenceThreshold: options.confidenceThreshold,
      }),
      ...(options?.minFramesPerNote !== undefined && {
        minFramesPerNote: options.minFramesPerNote,
      }),
      ...(options?.pitchBinToleranceCents !== undefined && {
        pitchBinToleranceCents: options.pitchBinToleranceCents,
      }),
      ...(options?.segmentMode !== undefined && { mode: options.segmentMode }),
      ...(options?.smoothFrames !== undefined && { smoothFrames: options.smoothFrames }),
      ...(options?.tuningCorrect !== undefined && { tuningCorrect: options.tuningCorrect }),
    };
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

    if (numFrames < sess.cachedFrames) {
      sess.cachedFrames = 0;
      sess.activations = new Float32Array(0);
      sess.confidence = new Float32Array(0);
    }

    if (numFrames * NUM_BINS > sess.activations.length) {
      const grownAct = new Float32Array(numFrames * NUM_BINS);
      grownAct.set(sess.activations);
      sess.activations = grownAct;
      const grownConf = new Float32Array(numFrames);
      grownConf.set(sess.confidence);
      sess.confidence = grownConf;
    }

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
      // Framing stays here (the forward pass is the only thing the backend runs).
      const flat = new Float32Array(batchCount * FRAME_SIZE);
      for (let f = 0; f < batchCount; f++) {
        const start = (batchStart + f) * HOP_SIZE;
        const window = samples.subarray(start, start + FRAME_SIZE);
        flat.set(normalizeFrame(window), f * FRAME_SIZE);
      }
      const actBatch = await this.backend.crepePredict(flat, batchCount);
      // Confidence is the per-frame activation max — derived here so it never
      // crosses the wire (it's a trivial reduction of `actBatch`).
      const confBatch = new Float32Array(batchCount);
      for (let f = 0; f < batchCount; f++) {
        let max = -Infinity;
        const base = f * NUM_BINS;
        for (let b = 0; b < NUM_BINS; b++) {
          if (actBatch[base + b] > max) max = actBatch[base + b];
        }
        confBatch[f] = max;
      }
      sess.activations.set(actBatch, batchStart * NUM_BINS);
      sess.confidence.set(confBatch, batchStart);
    }
    sess.cachedFrames = numFrames;

    const path = viterbi(sess.activations, numFrames, VITERBI_OPTS);
    const cents = localCentsFromPath(
      sess.activations,
      path,
      numFrames,
      this.centMapping,
      NUM_BINS,
      LOCAL_AVG_HALF_WIDTH,
    );

    const notes = segmentNotes(cents, sess.confidence, numFrames, segmentOpts);
    onProgress?.(notes);
    return notes;
  }
}

/**
 * CREPE bin index → absolute MIDI cents (A4 = 6900). CREPE outputs cents
 * referenced to 10 Hz; we shift to A4-reference so downstream `cents/100`
 * gives the MIDI note number directly.
 */
function buildCentMapping(): Float32Array {
  const arr = new Float32Array(NUM_BINS);
  const offset = 6900 + 1200 * Math.log2(10 / 440);
  for (let i = 0; i < NUM_BINS; i++) {
    const crepeCents =
      CREPE_CENTS_OFFSET + (CREPE_CENTS_RANGE * i) / (NUM_BINS - 1);
    arr[i] = crepeCents + offset;
  }
  return arr;
}
