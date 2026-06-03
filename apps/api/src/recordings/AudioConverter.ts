import type { NoteEventTime } from '@spotify/basic-pitch';

import { ExtractedNotes, ExtractOptions, NoteExtractor } from './NoteExtractor';
import { OnsetDetector } from './OnsetDetector';
import type {
  PitchProvider,
  PitchSession,
  PitchTranscribeOptions,
} from './providers/PitchProvider';

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
    extractor?: NoteExtractor,
    /** Split sustained runs at audio re-attacks to recover repeated notes. */
    enableOnsetSplit = true,
  ) {
    this.extractor = extractor ?? new NoteExtractor();
    this.session = provider.createSession();
    // Only providers without native onset detection (CREPE/PESTO) need the
    // amplitude re-attack splitter; basic-pitch already emits onsets, so adding
    // it there would double-split and hurt precision.
    this.onsetDetector =
      enableOnsetSplit && !provider.hasNativeOnsets ? new OnsetDetector() : null;
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
