import type { NoteEventTime } from '@spotify/basic-pitch';

import {
  ExtractedNotes,
  ExtractOptions,
  NoteExtractor,
  type NoteExtractorOptions,
} from './note-extractor';
import { OnsetDetector } from './onset-detector';
import type { PipelineProfile } from './profiles/pipeline-profile';
import type {
  PitchProvider,
  PitchSession,
  PitchTranscribeOptions,
} from './providers/pitch-provider';

/**
 * Provider-agnostic audio → notes pipeline. Hands the PCM samples to the
 * configured `PitchProvider`, then runs the result through `NoteExtractor`'s
 * monophonic + beat-grid post-processing. Wires the provider's progress
 * callback through to the caller so partial results stream out as the
 * provider works.
 *
 * One converter is created per recording, so it owns the provider's
 * session-scoped state. The session lets incremental providers (e.g. CREPE)
 * cache per-frame outputs across passes within the recording.
 */
export class AudioConverter {
  private readonly extractor: NoteExtractor;
  private readonly session: PitchSession | undefined;
  private readonly onsetDetector: OnsetDetector | null;

  constructor(
    readonly provider: PitchProvider,
    opts: {
      extractor?: NoteExtractor;
      /** Split sustained runs at audio re-attacks to recover repeated notes. */
      enableOnsetSplit?: boolean;
      /** Resolved profile — selects the cleanup set (voice vs trajectory vs note-level). */
      profile?: PipelineProfile;
    } = {},
  ) {
    const { extractor, enableOnsetSplit = true, profile } = opts;
    this.extractor =
      extractor ?? new NoteExtractor(AudioConverter.cleanupFor(provider, profile));
    this.session = provider.createSession();
    // Only providers without native onset detection (CREPE) need the
    // amplitude re-attack splitter; basic-pitch already emits onsets, so adding
    // it there would double-split and hurt precision.
    this.onsetDetector =
      enableOnsetSplit && !provider.hasNativeOnsets ? new OnsetDetector() : null;
  }

  /**
   * Which `NoteExtractor` cleanup steps suit this provider.
   *
   * The cleanup was written for a **note-level, polyphonic** upstream — its own
   * docstrings say so, e.g. the outlier filter targets "basic-pitch mis-labeling
   * the octave" and the merge exists to rejoin "basic-pitch splitting a held note".
   * A pitch-trajectory provider produces one note at a time by construction, and
   * measured on the real corpus two of those steps are actively harmful there:
   *
   *   dropping `pitchOutliers` + `merge`  →  **+0.027 F1@0.1 [+0.007, +0.051]**
   *   (paired bootstrap over 82 dev clips; the interval excludes zero, and the
   *    worst-dataset score improves too, 0.377 → 0.415)
   *
   * Why they hurt: `pitchOutliers` drops any note sitting ≥7 semitones from both
   * neighbours, which is a *real melodic leap* in instrumental writing, not an
   * octave error; and `merge` rejoins fragments that a trajectory segmenter never
   * split in the first place, so it can only eat genuine repeated notes.
   * `onsetSplit` is the one step measured to genuinely help (removing it costs
   * −0.013, interval excluding zero), and `monophonic` is now an exact no-op here
   * (ρ = 1.00) — it only ever fired via the floating-point bug in TOUCH_EPSILON_SEC.
   *
   * The note-level path keeps every step: it is what they were designed for, and
   * we have no real recorded corpus for that path (whistling/piccolo) to re-tune on.
   *
   * ## The voice path keeps only `onsetSplit`
   *
   * `VoiceNoteDecoder` already does, inside its decode, what the remaining steps
   * were bolted on to approximate: the A-B-A `transients` folder and the adaptive
   * length floor both exist to undo vibrato fragmentation, and the decoder's
   * note-change cost makes that fragmentation not happen in the first place.
   * Measured on the voice slice (`scripts/eval/sweep-voice.ts`, dev), each of them
   * on top of the voice decode is a small *loss*: transients −0.003, adaptive floor
   * as part of the full shipping set −0.008.
   *
   * `onsetSplit` is the exception and stays, because it is the pipeline's only
   * channel for **re-onsets** — a same-pitch re-articulation is invisible to a
   * pitch-trajectory decode by construction. Adding it lifts re-onset recall
   * 0.124 → 0.329 (dev) / 0.168 → 0.389 (test) at no cost to COnP. An in-decode
   * re-onset transition was implemented and measured as the principled alternative
   * (`VoiceDecodeOptions.reonsetCost`/`accentBonus`) and is a null with a broadband
   * envelope — see those docstrings before trying it again.
   */
  private static cleanupFor(
    provider: PitchProvider,
    profile?: PipelineProfile,
  ): NoteExtractorOptions {
    if (provider.hasNativeOnsets) return {};
    if (profile?.isVoice) {
      return {
        // The adaptive length floor earns its place back on the voice path
        // (2026-08-08, expanded voice slice): +0.009 dev / +0.010 held-out
        // test, spurious notes 26 → 24 per 100, re-onset recall unchanged —
        // and the gain is carried by the bleed-heavy choral corpora while
        // every solo corpus is untouched, i.e. it prunes neighbour-bleed
        // fragments. The earlier "−0.008" that removed it was measured as
        // part of the FULL cleanup set, not alone. `transients` and
        // `monophonic` stay off: re-adding them buys +0.006 more only on
        // choral bleed, at +18 % repair time and a vocadito loss.
        adaptiveFloorFraction: 0.3,
        steps: {
          pitchOutliers: false,
          merge: false,
          transients: false,
          monophonic: false,
        },
      };
    }
    return {
      steps: { pitchOutliers: false, merge: false },
      // Scale the spurious-fragment floor to the clip's own median note length.
      // This is the one thing measured to help the remaining failure — sustained
      // vibrato-heavy singing shattering into fragments — because it engages only
      // where the material is genuinely sustained and stays out of the way of fast
      // humming. **+0.008 F1@0.1 [+0.002, +0.016] dev / [+0.002, +0.015] test**,
      // paired over 94 clips, mir-qbsh excluded (its note labels are manufactured
      // by the harness, so gating on it rewards reproducing that artefact).
      // 0.4 and 0.5 measured slightly worse; it shipped as 0 (disabled) until now.
      adaptiveFloorFraction: 0.3,
    };
  }

  init(): Promise<void> {
    return this.provider.init();
  }

  async convert(
    samples: Float32Array,
    options: ExtractOptions,
    onPartial?: (extracted: ExtractedNotes) => void,
    pitchOptions?: PitchTranscribeOptions,
  ): Promise<ExtractedNotes> {
    // Onsets depend only on the audio, so compute once per pass and reuse
    // across the streaming progress callbacks.
    const onsetTimesSec = this.onsetDetector?.detect(
      samples,
      this.provider.sampleRate,
    );
    const extractOptions: ExtractOptions = { ...options, onsetTimesSec };

    let final: ExtractedNotes = { raw: [], deduced: [] };
    const handle = (raw: NoteEventTime[]): void => {
      final = this.extractor.extract(raw, extractOptions);
      onPartial?.(final);
    };
    const finalRaw = await this.provider.transcribe(
      samples,
      pitchOptions,
      handle,
      this.session,
    );
    // Ensure we always end on the truly-final raw set even if the provider
    // skipped its last in-progress callback.
    handle(finalRaw);
    return final;
  }
}
