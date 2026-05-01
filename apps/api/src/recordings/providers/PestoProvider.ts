import { Logger } from '@nestjs/common';
import type { NoteEventTime } from '@spotify/basic-pitch';
import { readFileSync } from 'fs';
import * as ort from 'onnxruntime-node';
import { join } from 'path';

import {
  localCentsFromPath,
  segmentNotes,
  type SegmentOptions,
  viterbi,
  type ViterbiOptions,
} from './pitchDecoder';
import type { PitchProvider, PitchSession } from './PitchProvider';

/**
 * Layout parameters baked into the ONNX file by `fetch-pesto-model.sh`.
 * `cache_size` is the receptive-field state we have to thread between calls
 * for streaming inference; `bins_per_semitone` and `num_bins` define the
 * pitch-bin → cents mapping; `hop_samples` and `sampling_rate` set the time
 * resolution.
 */
interface PestoMetadata {
  checkpoint: string;
  sampling_rate: number;
  hop_samples: number;
  step_size_ms: number;
  bins_per_semitone: number;
  num_bins: number;
  cache_size: number;
}

/** Half-width of the local weighted-mean window. PESTO's reference impl uses
 *  ±(bps - 1), giving a window of 2·bps - 1 = 5 bins for bps=3. We mirror that
 *  by computing it dynamically from the loaded metadata. */
const LOCAL_AVG_HALF_WIDTH_FROM_BPS = (bps: number): number => bps - 1;

/** σ in bins for the Viterbi transition kernel, scaled so the cents-equivalent
 *  σ stays around 240 cents (matches our CREPE setup). At bps=3 that's
 *  240/(100/3) = 7.2 → round to 7. */
const VITERBI_SIGMA_CENTS = 240;
/** Trailing cached frames recomputed every pass — but PESTO's streaming graph
 *  manages its own receptive-field cache, so we only have to redo a small
 *  guard band against ffmpeg-resampler tail wobble. */
const RECOMPUTE_TAIL_FRAMES = 5;

/**
 * Per-recording state for PESTO. Holds the streaming receptive-field cache
 * and the per-frame outputs from previous passes so subsequent calls only
 * run inference on new audio.
 */
class PestoSession implements PitchSession {
  /** Number of frames whose `activations` and `confidence` slots are populated. */
  cachedFrames = 0;
  /** Number of audio samples already fed to the ONNX graph. */
  processedSamples = 0;
  /** [cachedFrames * numBins] flat row-major activation matrix. */
  activations: Float32Array = new Float32Array(0);
  /** [cachedFrames] per-frame voicing probability from PESTO's confidence head. */
  confidence: Float32Array = new Float32Array(0);
  /** PESTO's internal receptive-field cache. Threaded through every ONNX run. */
  cache: Float32Array | null = null;
}

/**
 * Monophonic pitch transcriber backed by PESTO (Riou et al., ISMIR 2023),
 * loaded as ONNX via `onnxruntime-node`. ~30k parameters, ~10× faster than
 * CREPE on CPU, and self-supervised — drops in alongside the CREPE provider
 * as a third option.
 *
 * Loads `model.onnx` and `metadata.json` from a directory written by
 * `apps/api/scripts/fetch-pesto-model.sh`.
 */
export class PestoProvider implements PitchProvider {
  readonly name = 'pesto';
  readonly sampleRate: number;
  // PESTO normalizes internally via its CQT pipeline; ffmpeg loudnorm is
  // redundant and would break prefix-stability of the decoded samples
  // (same reasoning as the CREPE provider).
  readonly normalizeLoudness = false;

  private readonly logger = new Logger(PestoProvider.name);
  private readonly modelDir: string;
  private readonly centMapping: Float32Array;
  private readonly viterbiOpts: ViterbiOptions;
  private readonly segmentOpts: SegmentOptions;
  private readonly localAvgHalfWidth: number;
  private readonly meta: PestoMetadata;
  private sessionPromise: Promise<ort.InferenceSession> | null = null;

  constructor(modelDir: string) {
    this.modelDir = modelDir;
    const metaJson = readFileSync(join(modelDir, 'metadata.json'), 'utf8');
    const meta = JSON.parse(metaJson) as PestoMetadata;
    this.meta = meta;
    this.sampleRate = meta.sampling_rate;
    this.centMapping = buildCentMapping(meta.num_bins, meta.bins_per_semitone);
    this.localAvgHalfWidth = LOCAL_AVG_HALF_WIDTH_FROM_BPS(
      meta.bins_per_semitone,
    );
    const centsPerBin = 100 / meta.bins_per_semitone;
    const sigmaBins = Math.max(1, Math.round(VITERBI_SIGMA_CENTS / centsPerBin));
    this.viterbiOpts = {
      numBins: meta.num_bins,
      sigmaBins,
      bandBins: sigmaBins * 4,
    };
    this.segmentOpts = {
      hopSize: meta.hop_samples,
      sampleRate: meta.sampling_rate,
      confidenceThreshold: 0.5,
      minFreqHz: 65,
      maxFreqHz: 1100,
      // ~80 ms note minimum, scaled to PESTO's hop. At 10 ms hop = 8 frames.
      minFramesPerNote: Math.max(
        1,
        Math.round(0.08 / (meta.hop_samples / meta.sampling_rate)),
      ),
      pitchBinToleranceCents: 50,
    };
    this.logger.log(
      `pesto model dir: ${modelDir} (checkpoint=${meta.checkpoint}, ` +
        `bins=${meta.num_bins}, bps=${meta.bins_per_semitone}, ` +
        `hop=${meta.hop_samples}smp @ ${meta.sampling_rate}Hz)`,
    );
  }

  async init(): Promise<void> {
    if (!this.sessionPromise) {
      this.sessionPromise = ort.InferenceSession.create(
        join(this.modelDir, 'model.onnx'),
      );
    }
    await this.sessionPromise;
  }

  createSession(): PestoSession {
    return new PestoSession();
  }

  async transcribe(
    samples: Float32Array,
    onProgress?: (rawNotes: NoteEventTime[]) => void,
    session?: PitchSession,
  ): Promise<NoteEventTime[]> {
    const ortSession = await this.getSession();
    const sess =
      session instanceof PestoSession ? session : new PestoSession();

    // Defensive: a shrinking buffer (shouldn't happen with prefix-stable
    // decoding) means our streaming cache no longer matches the audio prefix.
    if (samples.length < sess.processedSamples) {
      sess.cachedFrames = 0;
      sess.processedSamples = 0;
      sess.activations = new Float32Array(0);
      sess.confidence = new Float32Array(0);
      sess.cache = null;
    }

    if (sess.cache === null) {
      sess.cache = new Float32Array(this.meta.cache_size);
    }

    // Take a small step back to absorb the resampler tail. Need to undo the
    // cached state we'd advanced past, but PESTO's cache is opaque — we can't
    // rewind it. So instead we drop the last RECOMPUTE_TAIL_FRAMES of cached
    // outputs and re-feed the corresponding samples through ONNX, letting the
    // streaming cache update naturally past them.
    if (sess.cachedFrames > 0) {
      const rewindFrames = Math.min(RECOMPUTE_TAIL_FRAMES, sess.cachedFrames);
      sess.cachedFrames -= rewindFrames;
      sess.processedSamples -= rewindFrames * this.meta.hop_samples;
      // sess.cache is still valid for the previous-pass tail — the rewind
      // will re-run those frames and overwrite their cached activations,
      // accepting that PESTO's streaming cache hasn't been rewound (one-shot
      // mismatch on the first re-fed frame). For 5-frame guard at 10 ms hop
      // that's a ≤ 50 ms warm-up at the seam.
    }

    const samplesToFeed = samples.subarray(sess.processedSamples);
    if (samplesToFeed.length >= this.meta.hop_samples) {
      // ONNX expects audio_length to be a multiple of hop_samples; otherwise
      // the trailing partial frame is silently dropped. Trim to a multiple
      // and leave the remainder for the next pass.
      const usable =
        Math.floor(samplesToFeed.length / this.meta.hop_samples) *
        this.meta.hop_samples;
      const audioInput = samplesToFeed.subarray(0, usable);
      const expectedNewFrames = usable / this.meta.hop_samples;

      const audioTensor = new ort.Tensor('float32', audioInput, [
        1,
        audioInput.length,
      ]);
      const cacheTensor = new ort.Tensor('float32', sess.cache, [
        1,
        this.meta.cache_size,
      ]);

      const out = await ortSession.run({
        audio: audioTensor,
        cache: cacheTensor,
      });
      const activations = out.activations.data as Float32Array;
      const confidence = out.confidence.data as Float32Array;
      const cacheOut = out.cache_out.data as Float32Array;
      const actualFrames = confidence.length;

      // The graph emits one frame per hop_samples chunk. If the count differs
      // from what we computed, trust the graph and adjust.
      const newFrames = Math.min(actualFrames, expectedNewFrames);

      const totalFrames = sess.cachedFrames + newFrames;
      if (totalFrames * this.meta.num_bins > sess.activations.length) {
        const grownAct = new Float32Array(totalFrames * this.meta.num_bins);
        grownAct.set(sess.activations);
        sess.activations = grownAct;
        const grownConf = new Float32Array(totalFrames);
        grownConf.set(sess.confidence);
        sess.confidence = grownConf;
      }
      sess.activations.set(
        activations.subarray(0, newFrames * this.meta.num_bins),
        sess.cachedFrames * this.meta.num_bins,
      );
      sess.confidence.set(
        confidence.subarray(0, newFrames),
        sess.cachedFrames,
      );
      sess.cache = new Float32Array(cacheOut);
      sess.cachedFrames = totalFrames;
      sess.processedSamples += usable;
    }

    if (sess.cachedFrames === 0) {
      onProgress?.([]);
      return [];
    }

    const path = viterbi(
      sess.activations,
      sess.cachedFrames,
      this.viterbiOpts,
    );
    const cents = localCentsFromPath(
      sess.activations,
      path,
      sess.cachedFrames,
      this.centMapping,
      this.meta.num_bins,
      this.localAvgHalfWidth,
    );
    const notes = segmentNotes(
      cents,
      sess.confidence,
      sess.cachedFrames,
      this.segmentOpts,
    );
    onProgress?.(notes);
    return notes;
  }

  private getSession(): Promise<ort.InferenceSession> {
    if (!this.sessionPromise) {
      this.sessionPromise = ort.InferenceSession.create(
        join(this.modelDir, 'model.onnx'),
      );
    }
    return this.sessionPromise;
  }
}

/**
 * PESTO bin index → absolute MIDI cents (A4 = 6900). PESTO outputs pitch
 * predictions in MIDI semitones (`bin / bins_per_semitone` = MIDI), so
 * cents = bin / bps · 100 directly.
 */
function buildCentMapping(numBins: number, bps: number): Float32Array {
  const arr = new Float32Array(numBins);
  for (let i = 0; i < numBins; i++) {
    arr[i] = (i / bps) * 100;
  }
  return arr;
}
