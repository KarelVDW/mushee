import type { NoteEventTime } from '../note-event'
import type { PitchTrack } from '../pitch-track'

/**
 * Opaque per-recording state owned by a `PitchProvider`. Exists so providers
 * with incremental/streaming workflows (CREPE caching activations across
 * passes) can hold session-scoped data. The recording pipeline creates one of
 * these at session start, hands it to every `transcribe` call for that session,
 * and discards it on finalize.
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
 *  - `minFramesPerNote`: shortest run (in provider frames) a trajectory provider
 *    will commit as a note. Lower keeps brief notes (recall) at some risk of
 *    noise; trajectory providers only.
 *  - `pitchBinToleranceCents`: cents a frame may deviate from a run's running
 *    median before it starts a new note; trajectory providers only.
 */
export interface PitchTranscribeOptions {
    minFreqHz?: number
    maxFreqHz?: number
    confidenceThreshold?: number
    minFramesPerNote?: number
    pitchBinToleranceCents?: number
    /**
     * Trajectory-provider note segmentation strategy.
     *
     * `'voice'` runs `VoiceNoteDecoder` instead of the semitone-run segmenter — a
     * note-level HMM with a silence state, which needs the frame envelope as well as
     * the pitch trajectory and is therefore the provider's job to drive (it is the
     * only thing holding both).
     */
    segmentMode?: 'median' | 'semitone' | 'voice'
    /** Semitone-mode median smoother half-window, in frames. */
    smoothFrames?: number
    /** Semitone-mode per-clip tuning-offset correction; default on. */
    tuningCorrect?: boolean
    /**
     * Set on a session's LAST pass (the whole take). Read only by the decode-side
     * reverb adaptation (`ReverbDecodeAdaptation`, built off), which re-measures the
     * whole take there instead of the evidence it froze mid-take.
     */
    finalPass?: boolean
}

/**
 * Provider-agnostic pitch transcriber. Implementations turn raw mono PCM into
 * a list of detected note events. Cleanup, monophonic selection, beat-grid
 * snapping etc. live downstream in `NoteExtractor` — providers should return
 * the rawest reasonable note set so the post-processor can do its work.
 */
export interface PitchProvider {
    /** Human-readable provider name, surfaced in logs. */
    readonly name: string

    /** Sample rate the provider expects on `transcribe(samples)` input. */
    readonly sampleRate: number

    /**
     * Whether the provider already detects note onsets itself (a note-level CNN has an
     * onset head). Trajectory providers (CREPE) segment only on pitch
     * stability and set this false, so the pipeline applies its own amplitude
     * re-attack splitting for them; providers with native onsets set it true to
     * avoid double-splitting.
     */
    readonly hasNativeOnsets: boolean

    /**
     * Whether the audio decoder should apply ffmpeg's `loudnorm` filter before
     * handing samples in. Providers that depend on the prefix of decoded audio
     * being stable across passes (so that `transcribe` can cache per-frame
     * outputs) MUST set this to false — `loudnorm` reads ahead and rescales
     * earlier samples when more input arrives, which would invalidate the cache.
     */
    readonly normalizeLoudness: boolean

    /** One-time setup (model load, backend init). Safe to call repeatedly. */
    init(): Promise<void>

    /**
     * Allocate a fresh session-scoped state for one recording. The pipeline
     * passes the same object back into every `transcribe` call within the session.
     */
    createSession(): PitchSession

    /**
     * Transcribe a chunk of mono PCM at `sampleRate` into raw note events.
     *
     * The pipeline always passes the WHOLE decoded buffer so far, every pass; a
     * provider that is cheaper on a trailing window must window inside its own
     * `PitchSession`. (Orchestrator-level windowing, with its context lead-in and
     * block alignment, lived in `RecordingPipeline` up to commit f0aa59a.)
     *
     * If `session` is provided, the implementation may use it to cache per-frame
     * state across calls within the same recording. Callers must pass the same
     * `session` object on every call within one recording, and must NOT share a
     * `session` between concurrent recordings.
     */
    transcribe(samples: Float32Array, options?: PitchTranscribeOptions, session?: PitchSession): Promise<NoteEventTime[]>

    /**
     * True when an earlier pass of `session` decoded under a take-level decision
     * (the decode-side reverb adaptation's gate) the final pass no longer agrees
     * with, so notes it committed may contradict the final ones. Optional: a
     * provider with no take-level adaptation never drifts.
     */
    voicingAdaptationDrifted?(session: PitchSession): boolean
}

/**
 * A provider that also exposes its frame-level measurement — the trajectory
 * `transcribe` segments, before any note decision. Both CREPE providers are one;
 * it is what lets the eval harness cache inference and sweep segmentation alone.
 * (scripts/eval/lib/trackCache.ts still declares a local copy of this interface
 * and its own `hasTrack` guard; adopting this one is a tracked follow-up.)
 */
export interface TrajectoryProvider extends PitchProvider {
    /** Frame-level trajectory of `samples`, with the same session caching as `transcribe`; null on too little audio. */
    track(samples: Float32Array, session?: PitchSession): Promise<PitchTrack | null>
}
