import type { NoteEventTime } from '@spotify/basic-pitch';

/**
 * Opaque per-recording state owned by a `PitchProvider`. Exists so providers
 * with incremental/streaming workflows (CREPE caching activations across
 * passes) can hold session-scoped data, while stateless providers can ignore
 * it. The recording pipeline creates one of these at session start, hands it
 * to every `transcribe` call for that session, and discards it on finalize.
 */
export interface PitchSession {}

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

  /**
   * Whether the audio decoder should apply ffmpeg's `loudnorm` filter before
   * handing samples in. Providers that depend on the prefix of decoded audio
   * being stable across passes (so that `transcribe` can cache per-frame
   * outputs) MUST set this to false — `loudnorm` reads ahead and rescales
   * earlier samples when more input arrives, which would invalidate the cache.
   */
  readonly normalizeLoudness: boolean;

  /** One-time setup (model load, backend init). Safe to call repeatedly. */
  init(): Promise<void>;

  /**
   * Allocate a fresh session-scoped state for one recording. Stateless
   * providers may return `undefined`. The pipeline passes the same object
   * back into every `transcribe` call within the session.
   */
  createSession(): PitchSession | undefined;

  /**
   * Transcribe a chunk of mono PCM at `sampleRate` into raw note events.
   *
   * If `onProgress` is provided it MUST be called at least once with the final
   * cumulative result, and SHOULD be called more times during processing so
   * downstream consumers can stream incremental updates. The returned promise
   * resolves with the same final array passed to the last `onProgress` call.
   *
   * If `session` is provided, the implementation may use it to cache per-frame
   * state across calls within the same recording. Callers must pass the same
   * `session` object on every call within one recording, and must NOT share a
   * `session` between concurrent recordings.
   */
  transcribe(
    samples: Float32Array,
    onProgress?: (rawNotes: NoteEventTime[]) => void,
    session?: PitchSession,
  ): Promise<NoteEventTime[]>;
}
