import { Logger } from '@nestjs/common';
import {
  NoteEventTime,
  noteFramesToTime,
  outputToNotesPoly,
} from '@spotify/basic-pitch';

import type { ModelBackend } from './model-backend';
import type { PitchProvider, PitchTranscribeOptions } from './pitch-provider';

/**
 * basic-pitch tuning. Defaults match Spotify's Python CLI rather than the
 * looser TS-port defaults.
 *
 * - Higher onset/frame thresholds suppress ghost notes.
 * - ~128 ms note minimum (drops sub-eighth-note blips).
 * - min/max frequency window cuts harmonic octave errors at the source.
 * - melodiaTrick disabled: it invents extra notes from sustained harmonics,
 *   which is harmful for monophonic sources.
 *
 * Durations are declared in seconds and converted to model frames against the
 * model's own hop below, so they keep their meaning independent of the grid.
 */
const ONSET_THRESHOLD = 0.5;
const FRAME_THRESHOLD = 0.3;
/** Shortest note kept, in seconds (Spotify CLI: 11 frames ≈ 127.7 ms). */
const MIN_NOTE_LEN_SEC = 0.128;
const INFER_ONSETS = true;
/** Hz. ~C6, top of normal vocal range. */
const MAX_FREQ = 1100;
/** Hz. C2, bottom of normal vocal range. */
const MIN_FREQ = 65;
const MELODIA_TRICK = false;
/** How long a note may dip below `FRAME_THRESHOLD` before it ends, in seconds. */
const ENERGY_TOLERANCE_SEC = 0.128;

const TARGET_SAMPLE_RATE = 22050;
/** The model's frame hop: FFT_HOP = 256 samples at 22050 Hz ≈ 11.6 ms. */
const MODEL_HOP_SEC = 256 / TARGET_SAMPLE_RATE;
const MIN_NOTE_LEN_FRAMES = Math.round(MIN_NOTE_LEN_SEC / MODEL_HOP_SEC);
const ENERGY_TOLERANCE_FRAMES = Math.round(ENERGY_TOLERANCE_SEC / MODEL_HOP_SEC);

export class BasicPitchProvider implements PitchProvider {
  readonly name = 'basic-pitch';
  readonly sampleRate = TARGET_SAMPLE_RATE;
  readonly normalizeLoudness = true;
  readonly hasNativeOnsets = true;
  // Stateless: each pass re-runs the model on whatever it's given, so the
  // pipeline feeds it only a trailing window rather than the whole recording.
  readonly cachesAcrossPasses = false;
  // basic-pitch frames the input into 2 s analysis windows that hop by
  // AUDIO_N_SAMPLES − OVERLAP_LENGTH = (22050·2 − 256) − (30·256) = 36164 samples.
  // A trailing window must start on that grid, else its block alignment (and the
  // per-block time correction) drifts from a whole-buffer run and shifts onsets.
  readonly windowAlignSamples = 36164;

  private readonly logger = new Logger(BasicPitchProvider.name);

  constructor(private readonly backend: ModelBackend) {
    this.logger.log('basic-pitch provider ready');
  }

  async init(): Promise<void> {
    await this.backend.warm('basic-pitch');
  }

  createSession(): undefined {
    return undefined;
  }

  async transcribe(
    samples: Float32Array,
    options?: PitchTranscribeOptions,
    onProgress?: (rawNotes: NoteEventTime[]) => void,
  ): Promise<NoteEventTime[]> {
    const minFreq = options?.minFreqHz ?? MIN_FREQ;
    const maxFreq = options?.maxFreqHz ?? MAX_FREQ;
    const onsetThreshold = options?.onsetThreshold ?? ONSET_THRESHOLD;
    const frameThreshold = options?.frameThreshold ?? FRAME_THRESHOLD;
    const keepShortLoud = options?.keepShortLoudRatio;
    const dropLongQuiet = options?.dropLongQuiet;

    // The backend runs only the model forward pass (framing + predict + the
    // overlap-trim stitch); note decoding stays here for parity with the eval.
    const { frames, onsets } = await this.backend.basicPitchForward(samples);

    // With the joint short-note rule active, the library's own duration floor
    // drops to ~3 frames and the duration × amplitude decision is made here —
    // the library filter is duration-only and cannot spare a loud staccato note.
    const minLenFrames =
      keepShortLoud !== undefined
        ? Math.max(1, Math.round(0.035 / MODEL_HOP_SEC))
        : MIN_NOTE_LEN_FRAMES;
    const rawEvents = outputToNotesPoly(
      frames,
      onsets,
      onsetThreshold,
      frameThreshold,
      minLenFrames,
      INFER_ONSETS,
      maxFreq,
      minFreq,
      MELODIA_TRICK,
      ENERGY_TOLERANCE_FRAMES,
    );
    let notes = noteFramesToTime(rawEvents);
    if (keepShortLoud !== undefined || dropLongQuiet) {
      // "Loud"/"quiet" are relative to this pass's own median amplitude, taken
      // over full-length notes so glitches cannot drag the anchor down.
      const fullLength = notes
        .filter((n) => n.durationSeconds >= MIN_NOTE_LEN_SEC)
        .map((n) => n.amplitude)
        .sort((a, b) => a - b);
      const anchor = fullLength.length
        ? fullLength[fullLength.length >> 1]
        : undefined;
      if (anchor !== undefined) {
        notes = notes.filter((n) => {
          if (n.durationSeconds < MIN_NOTE_LEN_SEC) {
            return (
              keepShortLoud !== undefined &&
              n.amplitude >= keepShortLoud * anchor
            );
          }
          if (
            dropLongQuiet &&
            n.durationSeconds >= (dropLongQuiet.minSec ?? 0.35) &&
            n.amplitude < (dropLongQuiet.quietRatio ?? 0.3) * anchor
          ) {
            return false;
          }
          return true;
        });
      } else if (keepShortLoud !== undefined) {
        // No full-length note to anchor on: fall back to the duration-only rule.
        notes = notes.filter((n) => n.durationSeconds >= MIN_NOTE_LEN_SEC);
      }
    }
    onProgress?.(notes);
    return notes;
  }
}
