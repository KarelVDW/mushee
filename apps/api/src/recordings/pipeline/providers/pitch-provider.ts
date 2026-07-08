import type { NoteEventTime } from '@spotify/basic-pitch';

/**
 * Opaque per-recording state owned by a `PitchProvider`. Exists so providers
 * with incremental/streaming workflows (CREPE caching activations across
 * passes) can hold session-scoped data, while stateless providers can ignore
 * it. The recording pipeline creates one of these at session start, hands it
 * to every `transcribe` call for that session, and discards it on finalize.
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type -- deliberate marker interface: each provider declares its own session shape via `implements`
export interface PitchSession {}

/**
 * Per-call tuning, supplied by the pipeline from the active `PipelineProfile`.
 * Every field is optional; a provider falls back to its own defaults for any
 * field left undefined, so omitting the argument entirely preserves the
 * provider's historical behavior.
 *
 *  - `minFreqHz` / `maxFreqHz`: frequency window the provider should keep. The
 *    single most important lever for adapting to register — whistles need a
 *    high ceiling, bass voices a low floor.
 *  - `confidenceThreshold`: voicing gate for the pitch-trajectory providers
 *    (CREPE).
 *  - `onsetThreshold` / `frameThreshold`: basic-pitch note-gating thresholds.
 *  - `minFramesPerNote`: shortest run (in provider frames) a trajectory provider
 *    will commit as a note. Lower keeps brief notes (recall) at some risk of
 *    noise; trajectory providers only.
 *  - `pitchBinToleranceCents`: cents a frame may deviate from a run's running
 *    median before it starts a new note; trajectory providers only.
 */
export interface PitchTranscribeOptions {
  minFreqHz?: number;
  maxFreqHz?: number;
  confidenceThreshold?: number;
  onsetThreshold?: number;
  frameThreshold?: number;
  minFramesPerNote?: number;
  pitchBinToleranceCents?: number;
  /** Trajectory-provider note segmentation strategy ('median' | 'semitone'). */
  segmentMode?: 'median' | 'semitone';
  /** Semitone-mode median smoother half-window, in frames. */
  smoothFrames?: number;
  /** Semitone-mode per-clip tuning-offset correction; default on. */
  tuningCorrect?: boolean;
}

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
   * Whether the provider already detects note onsets itself (basic-pitch has an
   * onset head). Trajectory providers (CREPE) segment only on pitch
   * stability and set this false, so the pipeline applies its own amplitude
   * re-attack splitting for them; providers with native onsets set it true to
   * avoid double-splitting.
   */
  readonly hasNativeOnsets: boolean;

  /**
   * Whether the audio decoder should apply ffmpeg's `loudnorm` filter before
   * handing samples in. Providers that depend on the prefix of decoded audio
   * being stable across passes (so that `transcribe` can cache per-frame
   * outputs) MUST set this to false — `loudnorm` reads ahead and rescales
   * earlier samples when more input arrives, which would invalidate the cache.
   */
  readonly normalizeLoudness: boolean;

  /**
   * Whether the provider caches per-frame state across `transcribe` calls within
   * a session (via `PitchSession`) so that re-passing the whole growing buffer is
   * already incremental. The pipeline uses this to decide how to feed audio:
   *
   *  - `true`  (e.g. CREPE): hand over the full decoded buffer every pass; the
   *    provider only recomputes new frames. Its decode/segmentation rely on a
   *    consistent absolute frame index, so it must NOT be fed a sliding window.
   *  - `false` (e.g. basic-pitch): stateless and reprocesses everything it's
   *    given, so the pipeline transcribes only a trailing window (committed audio
   *    is never re-sent) and offsets the returned note times.
   */
  readonly cachesAcrossPasses: boolean;

  /**
   * Sample count the pipeline must snap a trailing window's start to (windowed
   * providers only). Providers that frame the input into fixed analysis blocks
   * produce block-position-dependent timing, so a window must begin on a block
   * boundary for its notes to match a whole-buffer run. 1 = no constraint.
   */
  readonly windowAlignSamples: number;

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
    options?: PitchTranscribeOptions,
    onProgress?: (rawNotes: NoteEventTime[]) => void,
    session?: PitchSession,
  ): Promise<NoteEventTime[]>;
}
