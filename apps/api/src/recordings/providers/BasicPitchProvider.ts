import { Logger } from '@nestjs/common';
import {
  BasicPitch,
  NoteEventTime,
  noteFramesToTime,
  outputToNotesPoly,
} from '@spotify/basic-pitch';

import { BasicPitchModelLoader } from './BasicPitchModelLoader';
import type { PitchProvider, PitchTranscribeOptions } from './PitchProvider';

/**
 * basic-pitch tuning. Defaults match Spotify's Python CLI rather than the
 * looser TS-port defaults.
 *
 * - Higher onset/frame thresholds suppress ghost notes.
 * - 11-frame minimum at 22050/256 hop ≈ 127 ms (drops sub-eighth-note blips).
 * - min/max frequency window cuts harmonic octave errors at the source.
 * - melodiaTrick disabled: it invents extra notes from sustained harmonics,
 *   which is harmful for monophonic sources.
 */
const ONSET_THRESHOLD = 0.5;
const FRAME_THRESHOLD = 0.3;
const MIN_NOTE_LEN_FRAMES = 11;
const INFER_ONSETS = true;
/** Hz. ~C6, top of normal vocal range. */
const MAX_FREQ = 1100;
/** Hz. C2, bottom of normal vocal range. */
const MIN_FREQ = 65;
const MELODIA_TRICK = false;
const ENERGY_TOLERANCE = 11;

const TARGET_SAMPLE_RATE = 22050;

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
  private readonly loader: BasicPitchModelLoader;

  constructor(modelDir: string) {
    this.loader = new BasicPitchModelLoader(modelDir);
    this.logger.log(`basic-pitch model dir: ${modelDir}`);
  }

  async init(): Promise<void> {
    await this.loader.load();
  }

  createSession(): undefined {
    return undefined;
  }

  async transcribe(
    samples: Float32Array,
    options?: PitchTranscribeOptions,
    onProgress?: (rawNotes: NoteEventTime[]) => void,
  ): Promise<NoteEventTime[]> {
    const model = await this.loader.load();
    const basicPitch = new BasicPitch(Promise.resolve(model));
    const frames: number[][] = [];
    const onsets: number[][] = [];

    const minFreq = options?.minFreqHz ?? MIN_FREQ;
    const maxFreq = options?.maxFreqHz ?? MAX_FREQ;
    const onsetThreshold = options?.onsetThreshold ?? ONSET_THRESHOLD;
    const frameThreshold = options?.frameThreshold ?? FRAME_THRESHOLD;

    const emitCurrent = (): NoteEventTime[] => {
      const rawEvents = outputToNotesPoly(
        frames,
        onsets,
        onsetThreshold,
        frameThreshold,
        MIN_NOTE_LEN_FRAMES,
        INFER_ONSETS,
        maxFreq,
        minFreq,
        MELODIA_TRICK,
        ENERGY_TOLERANCE,
      );
      const notes = noteFramesToTime(rawEvents);
      onProgress?.(notes);
      return notes;
    };

    await basicPitch.evaluateModel(
      samples,
      (f, o) => {
        frames.push(...f);
        onsets.push(...o);
        if (onProgress) emitCurrent();
      },
      () => {},
    );
    return emitCurrent();
  }
}
