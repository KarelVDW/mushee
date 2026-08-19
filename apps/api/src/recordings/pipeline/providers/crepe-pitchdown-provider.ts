import type { NoteEventTime } from '@spotify/basic-pitch';

import { CrepeProvider } from './crepe-provider';
import type { ModelBackend } from './model-backend';
import type {
  PitchProvider,
  PitchSession,
  PitchTranscribeOptions,
} from './pitch-provider';

/**
 * CREPE analysing the audio ONE OCTAVE DOWN — a trajectory provider for the
 * register above CREPE's own ~1997 Hz ceiling (piccolo, whistling), i.e. a
 * candidate replacement for basic-pitch's one remaining register.
 *
 * The shift is exact and artifact-free: this provider declares
 * `sampleRate = 32 kHz`, so the decoder hands it 32 kHz samples, and the inner
 * CREPE reads them as 16 kHz — the take plays at half speed, every frequency
 * halves (harmonic structure preserved, like a tape machine slowed down), and
 * every duration doubles. The wrapper rescales the note events back
 * (times ÷ 2, pitches + 12 st) and halves the frequency window on the way in.
 * The price is 2× inference cost on this band, and this band only.
 *
 * Effective coverage: 2 × [~32.7, ~1997] Hz ≈ up to ~3.9 kHz — above the
 * highest note the synthetic very-high corpus contains (3 729 Hz), though
 * short of basic-pitch's nominal 4.5 kHz top; see
 * `PITCHDOWN_MODEL_CEILING_HZ`.
 *
 * Measured (scripts/eval/bench-crepe-pitchdown.ts, whistle-mid/high + piccolo
 * × 7 conditions, COnP@±100 ms, paired over 84 clips, 2026-08-19): pooled
 * 0.578 vs basic-pitch's 0.556 (+0.022 [−0.010, +0.054]); with the resolver's
 * reverberance ramp on the gate (which a basic-pitch band can never have)
 * 0.583 (+0.028 [−0.003, +0.059]). Clean condition 0.966 vs 0.881; the one
 * remaining deficit is heavy reverb (echoey-room 0.27 vs 0.34, distant-mic
 * 0.18 vs 0.23). A 2-octave variant measured worse (0.548) — the deeper shift
 * buys no extra coverage the corpus uses and costs 4× inference. Synthetic
 * corpus only: no real note-annotated whistling/piccolo recordings exist
 * (README open items), which is equally true of the shipping basic-pitch path.
 *
 * OFF by default: nothing routes here unless `RECORDING_VERY_HIGH_CREPE=1`
 * swaps the `very-high` band onto this provider (pipeline-profile.ts).
 */
export class CrepePitchdownProvider implements PitchProvider {
  readonly name: string;
  /** Slow-down factor: decode at 16 kHz × this, analyse as 16 kHz. */
  private readonly factor = 2;
  private readonly semitones = 12;
  readonly sampleRate: number;
  readonly normalizeLoudness = false;
  readonly hasNativeOnsets = false;
  readonly cachesAcrossPasses = true;
  readonly windowAlignSamples = 1;

  private readonly inner: CrepeProvider;

  constructor(backend: ModelBackend, name = 'crepe-tiny-down1') {
    this.name = name;
    this.inner = new CrepeProvider(backend, name);
    this.sampleRate = this.inner.sampleRate * this.factor;
  }

  init(): Promise<void> {
    return this.inner.init();
  }

  createSession(): PitchSession {
    return this.inner.createSession();
  }

  async transcribe(
    samples: Float32Array,
    options?: PitchTranscribeOptions,
    onProgress?: (rawNotes: NoteEventTime[]) => void,
    session?: PitchSession,
  ): Promise<NoteEventTime[]> {
    const k = this.factor;
    const scaled: PitchTranscribeOptions = {
      ...options,
      minFreqHz: options?.minFreqHz !== undefined ? options.minFreqHz / k : undefined,
      maxFreqHz: options?.maxFreqHz !== undefined ? options.maxFreqHz / k : undefined,
      // The profile declares its note floor in provider frames; one inner frame
      // covers 1/k of the real time, so the count must scale to keep the floor.
      minFramesPerNote: (options?.minFramesPerNote ?? 4) * k,
      // The voice decode is calibrated on real-time singing and the very-high
      // band is whistling territory where it deliberately never applied; do not
      // let it run on slowed audio it was never measured on.
      segmentMode:
        options?.segmentMode === 'voice' ? 'semitone' : options?.segmentMode,
    };
    const raw = await this.inner.transcribe(
      samples,
      scaled,
      onProgress ? (notes) => onProgress(this.unscale(notes)) : undefined,
      session,
    );
    return this.unscale(raw);
  }

  /** Model-domain notes (half speed, an octave low) → real-domain notes. */
  private unscale(notes: NoteEventTime[]): NoteEventTime[] {
    const k = this.factor;
    return notes.map((n) => {
      // Not on the library type — the trajectory segmenters attach it (E1).
      const float = (n as NoteEventTime & { pitchMidiFloat?: number })
        .pitchMidiFloat;
      return {
        ...n,
        startTimeSeconds: n.startTimeSeconds / k,
        durationSeconds: n.durationSeconds / k,
        pitchMidi: n.pitchMidi + this.semitones,
        ...(float !== undefined && { pitchMidiFloat: float + this.semitones }),
      } as NoteEventTime;
    });
  }
}
