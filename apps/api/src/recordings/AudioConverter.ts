import type { NoteEventTime } from '@spotify/basic-pitch';

import { ExtractedNotes, ExtractOptions, NoteExtractor } from './NoteExtractor';
import type { PitchProvider } from './providers/PitchProvider';

/**
 * Provider-agnostic audio → notes pipeline. Hands the PCM samples to the
 * configured `PitchProvider`, then runs the result through `NoteExtractor`'s
 * monophonic + beat-grid post-processing. Wires the provider's progress
 * callback through to the caller so partial results stream out as the
 * provider works.
 */
export class AudioConverter {
  private readonly extractor: NoteExtractor;

  constructor(
    readonly provider: PitchProvider,
    extractor?: NoteExtractor,
  ) {
    this.extractor = extractor ?? new NoteExtractor();
  }

  init(): Promise<void> {
    return this.provider.init();
  }

  async convert(
    samples: Float32Array,
    options: ExtractOptions,
    onPartial?: (extracted: ExtractedNotes) => void,
  ): Promise<ExtractedNotes> {
    let final: ExtractedNotes = { raw: [], deduced: [] };
    const handle = (raw: NoteEventTime[]): void => {
      final = this.extractor.extract(raw, options);
      onPartial?.(final);
    };
    const finalRaw = await this.provider.transcribe(samples, handle);
    // Ensure we always end on the truly-final raw set even if the provider
    // skipped its last in-progress callback.
    handle(finalRaw);
    return final;
  }
}
