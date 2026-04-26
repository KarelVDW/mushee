import type { NoteEventTime } from '@spotify/basic-pitch';

/**
 * Provider-agnostic pitch transcriber. Implementations turn raw mono PCM into
 * a list of detected note events. Cleanup, monophonic selection, beat-grid
 * snapping etc. live downstream in `NoteExtractor` — providers should return
 * the rawest reasonable note set so the post-processor can do its work.
 */
export interface PitchProvider {
  /** Human-readable provider name, surfaced in logs. */
  readonly name: string;

  /** Sample rate the provider expects on `transcribe(samples)` input. */
  readonly sampleRate: number;

  /** One-time setup (model load, backend init). Safe to call repeatedly. */
  init(): Promise<void>;

  /**
   * Transcribe a chunk of mono PCM at `sampleRate` into raw note events.
   *
   * If `onProgress` is provided it MUST be called at least once with the final
   * cumulative result, and SHOULD be called more times during processing so
   * downstream consumers can stream incremental updates. The returned promise
   * resolves with the same final array passed to the last `onProgress` call.
   */
  transcribe(
    samples: Float32Array,
    onProgress?: (rawNotes: NoteEventTime[]) => void,
  ): Promise<NoteEventTime[]>;
}
