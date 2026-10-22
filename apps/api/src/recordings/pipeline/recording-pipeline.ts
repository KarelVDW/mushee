import { Logger } from '@nestjs/common'

import { AudioConverter } from './audio-converter'
import { AudioDecoder, StreamingDecoder } from './audio-decoder'
import { describeError } from './describe-error'
import { envFlag, envNumber, envPositiveNumber } from './env'
import type { MxmlMeasure } from './mxml.types'
import { MxmlBuilder, PendingNote } from './mxml-builder'
import type { NoteEventTime } from './note-event'
import { ExtractedNotes } from './note-extractor'
import type { PipelineProfile } from './profiles/pipeline-profile'
import { DETECT_DECODE, DETECT_SAMPLE_RATE, ProfileResolver } from './profiles/profile-resolver'
import { ProviderRegistry } from './providers/provider-registry'
import { RecordingDebugRenderer } from './recording-debug-renderer'

const DEFAULT_BPM = 120
const DEFAULT_BEATS = 4
const DEFAULT_BEAT_TYPE = 4
// Pass cadence. Overridable so eval harnesses can drive many incremental passes
// without waiting in real time; unset in production, where it stays 1 s.
const DEBOUNCE_MS = envPositiveNumber('RECORDING_DEBOUNCE_MS', 1000)
/**
 * OFFSET-confirmation margin (E5/R12): a note is committed once this much
 * audio exists past its END — the streaming analogue of Essentia Pitch2Midi's
 * note-off confirmation (its default is 200 ms; ours has been 400 ms). It is
 * the commit-latency knob. Env-overridable so `check-streaming.ts` can measure
 * where paced-feed commits start to contradict the whole-buffer result.
 * (R12's asymmetric ONSET confirmation has no analogue here: our commit unit
 * is a whole note, so an onset is never committed before its offset. And its
 * delay compensation does not apply either — we report measured note times,
 * not confirmation times; R7 calibrated the reported-time bias at 0.)
 */
const STABLE_MARGIN_SEC = envPositiveNumber('RECORDING_STABLE_MARGIN_SEC', 0.4)
/** Minimum audio before we trust the pitch scan enough to lock a profile. */
const DETECT_MIN_SEC = 1.2
/**
 * How long to keep waiting for PITCHED audio before accepting the unvoiced
 * fallback profile. The scan of a prefix that holds no reliable pitch — the
 * performer breathing, a late start after the count-in, a spoken word — used to
 * lock `default-wide` for the whole take: a 55–1900 Hz window with no register
 * band, no reverb relief, and (for whistling) a ceiling under the material. The
 * eval census found this fallback on 188 real adverse clips plus every take with
 * an unscannable lead-in, and measured that NO provider transcribes anything
 * through it (COnP ≈ 0.001). Waiting for the first pitched second costs the user
 * nothing visible — no notes exist to emit before then — so the lock now waits
 * up to this long; past it (or on the final pass) the fallback is accepted, and
 * the final pass re-resolves it over the whole take (see `process`).
 */
const DETECT_MAX_WAIT_SEC = envNumber('RECORDING_DETECT_MAX_WAIT_SEC', 8)
/**
 * Kill-switch for the final-pass re-route of a fallback-locked take
 * (`RECORDING_FINAL_REROUTE=0`). Together with `RECORDING_DETECT_MAX_WAIT_SEC=0`
 * this reproduces the pre-2026-09 lock behaviour exactly — the A/B the
 * `probe-leadin.ts` harness measures, and production's rollback.
 */
const FINAL_REROUTE = envFlag('RECORDING_FINAL_REROUTE')

export interface ScoreUpdate {
    measures: Record<number, MxmlMeasure>
}

/** Transcription health: `ok: false` after a failed pass (with the internal error for the log), `ok: true` once a pass succeeds again. */
export type PipelineHealth = { ok: true } | { ok: false; message: string }

/** The debug artifacts archived beside a take's audio once it ends. */
export interface DebugBundle {
    /** Raw vs committed notes over time (`RecordingDebugRenderer`). */
    plotSvg?: string
    /** Every bar of the take as the builder writes it. */
    scoreJson?: string
    /** Routing, timings and the note lists, for diagnosing a take after the fact. */
    sessionMeta?: object
}

/**
 * Where a session's audio and debug bundle are archived. Declared here, by its
 * consumer, so `pipeline/` never imports the persistence layer above it;
 * `RecordingArchiver` implements it over the `StorageService`.
 */
export interface PipelineArchive {
    /** One encoded chunk, forwarded as it arrives. */
    appendAudio(chunk: Buffer): void
    /** Close the audio upload and write the bundle. Called once, after the last chunk. */
    finalize(bundle: DebugBundle): Promise<void>
}

/**
 * How the locked profile decided what is at the microphone. Emitted once per
 * session so the client can show the user what the pipeline believes it is
 * hearing — a mis-routed take is invisible otherwise, and the user is the one
 * person who knows the truth.
 */
export interface SourceResolution {
    source: 'voice' | 'instrument'
    decidedBy: 'explicit' | 'classifier' | 'prior'
}

/**
 * What a client may tell the pipeline about the take it is about to stream.
 * Every field is optional: a field left out keeps the pipeline's default (or
 * the value an earlier `setMeta` gave it).
 */
export interface RecordingMeta {
    bpm?: number
    timeSignature?: { beats: number; beatType: number } | null
    /** Sounding − written, in semitones. Trumpet B♭ = −2, French Horn = −7, Piccolo = +12. */
    chromaticTranspose?: number
    /** Selected instrument id (e.g. 'trumpet'). Optional hint that seeds the
     *  adaptive profile's frequency window; auto-detection stays authoritative. */
    instrumentId?: string
    /**
     * Explicit declaration of what is being recorded. Unlike `instrumentId` this
     * is NOT just a window hint: singing and playing want different note
     * segmentation (see `VoiceNoteDecoder`), and the choice is worth ~0.10 COnP
     * on real singing.
     *
     * Since the audio source classifier (`SourceClassifier`, 2026-08) the web
     * client no longer sends this — absent means "classify from the audio, fall
     * back to the score's instrument family on abstain". Kept as an accepted
     * field because an explicit declaration still wins outright when a caller
     * (the eval harness, a future API client) genuinely knows the source.
     */
    sourceKind?: 'voice' | 'instrument' | null
    /**
     * The score's key signature at the recording start, in fifths (positive =
     * sharps). Sung takes are spelled on the singer's own tuning grid, and for
     * the notes still ambiguous after that normalization the key gets a vote —
     * a user recording into a D-major score almost certainly means F♯, not the
     * F they sang 40 cents flat. Optional: without it, spelling still
     * normalizes, it just cannot key-snap.
     */
    keyFifths?: number | null
    /** MediaRecorder encoding the client negotiated (e.g. 'audio/webm;codecs=opus',
     *  Safari: 'audio/mp4'). Seeds ffmpeg's input-format hint; `null`/absent means
     *  the browser default was used and ffmpeg probes the container. */
    mimeType?: string | null
}

/**
 * One pipeline per recording session. Audio is decoded once, incrementally, by a
 * long-lived `StreamingDecoder` (each byte decoded exactly once into a growing
 * PCM buffer) rather than by re-decoding the whole container every pass.
 * Periodically it runs the configured `AudioConverter` and emits MxmlMeasure
 * deltas as notes settle.
 *
 * Per-pass transcription is bounded too: every pass hands the provider the whole
 * decoded buffer, and the provider's `PitchSession` keeps it incremental (CREPE
 * caches activations by absolute frame). Together this makes per-pass work
 * proportional to the new audio, not the total recording length.
 */
export class RecordingPipeline {
    private readonly logger = new Logger(RecordingPipeline.name)
    private readonly decoder = new AudioDecoder()

    private readonly chunks: Buffer[] = []
    private chunkBytes = 0
    private readonly emittedNotes: PendingNote[] = []
    private readonly emittedKeys = new Set<string>()
    private lastRawNotes: NoteEventTime[] = []
    private lastDuration = 0
    private archivePromise: Promise<void> | null = null
    // Set by the session once its recording row exists; archives the encoded
    // audio (streamed chunk-by-chunk) and the debug bundle to blob storage.
    private archiver: PipelineArchive | null = null

    // Long-lived decode for this session, spawned once the profile (and thus the
    // sample rate / high-pass / loudnorm) is locked. Null until then.
    private streamDecoder: StreamingDecoder | null = null
    // Highest measure index emitted so far, and the first index never emitted — used
    // to fill in bars the performer rested through (see affectedMeasures).
    private lastEmittedMeasure = -1
    private firstUnemittedMeasure = 0
    // Set when the final pass re-routed the take (see `rerouteFinal`): everything
    // emitted so far came from the wrong profile, so the final emission must
    // rebuild every measure — including ones that end up empty.
    private reemitAll = false

    private readonly timings = {
        firstChunkAt: 0,
        firstDecodeAt: 0,
        firstUpdateAt: 0,
        processCount: 0,
        processTotalMs: 0,
        processMaxMs: 0,
        /** Every pass's wall time, for percentiles in the load-test harness (bounded: one entry per pass, ~1/s). */
        passMs: [] as number[],
    }

    private bpm = DEFAULT_BPM
    private beats = DEFAULT_BEATS
    private beatType = DEFAULT_BEAT_TYPE
    private chromaticTranspose = 0
    // Key signature at the recording start (fifths), for voice pitch spelling.
    private keyFifths: number | null = null

    private processing = false
    private rerunRequested = false
    private finalRequested = false
    private debounceTimer: NodeJS.Timeout | null = null
    private onUpdate: (update: ScoreUpdate) => void = () => {}
    private onSourceResolved: (resolution: SourceResolution) => void = () => {}
    private onHealth: (health: PipelineHealth) => void = () => {}
    private consecutiveFailures = 0

    // Which provider runs and with what frequency window / high-pass / thresholds.
    // Locked once the scanned prefix (≥ DETECT_MIN_SEC) holds pitch — deferred up
    // to DETECT_MAX_WAIT_SEC while it does not, or taken on the final pass — and
    // kept for the session, except that a take locked on the fallback is
    // re-resolved over the whole audio on the final pass (`rerouteFinal`).
    // `converter` is built to match the chosen provider.
    private profile: PipelineProfile | null = null
    private converter: AudioConverter | null = null
    private instrumentHint: string | undefined
    // Explicit "what are you recording?" choice from the client, when it made one.
    // Overrides the score's instrument as the voice-routing signal.
    private sourceKind: 'voice' | 'instrument' | undefined
    // ffmpeg input-format hint derived from the client's negotiated MIME type.
    // Undefined (unknown type / no meta) means ffmpeg probes the container.
    private inputFormat: string | undefined
    // Declared after the meta and profile fields it is built from (see `createBuilder`).
    private builder = this.createBuilder()

    constructor(
        private readonly registry: ProviderRegistry,
        private readonly resolver: ProfileResolver,
    ) {}

    setMeta(meta: RecordingMeta): void {
        if (meta.bpm) this.bpm = meta.bpm
        if (meta.timeSignature) {
            this.beats = meta.timeSignature.beats
            this.beatType = meta.timeSignature.beatType
        }
        if (typeof meta.chromaticTranspose === 'number') {
            this.chromaticTranspose = meta.chromaticTranspose
        }
        if (meta.instrumentId) this.instrumentHint = meta.instrumentId
        if (meta.sourceKind === 'voice' || meta.sourceKind === 'instrument') {
            this.sourceKind = meta.sourceKind
        }
        if (typeof meta.keyFifths === 'number') this.keyFifths = meta.keyFifths
        if (typeof meta.mimeType === 'string') {
            this.inputFormat = AudioDecoder.inputFormatFor(meta.mimeType)
        }
        this.builder = this.createBuilder()
    }

    /**
     * The builder is configured from two sources that change independently: the
     * take's meta (`setMeta`) and the routing decision — voice spelling on the
     * take's own tuning grid — which belongs to the locked profile (`lockProfile`).
     * Both rebuild it here, so neither can leave the other's half stale.
     */
    private createBuilder(): MxmlBuilder {
        return new MxmlBuilder({
            bpm: this.bpm,
            beats: this.beats,
            beatType: this.beatType,
            chromaticTranspose: this.chromaticTranspose,
            keyFifths: this.keyFifths,
            voiceSpelling: this.profile?.isVoice ?? false,
        })
    }

    setOnUpdate(cb: (update: ScoreUpdate) => void): void {
        this.onUpdate = cb
    }

    /** Processing statistics of this take (read-only view) — what the load-test harness reports per session. */
    get stats(): Readonly<RecordingPipeline['timings']> {
        return this.timings
    }

    setOnSourceResolved(cb: (resolution: SourceResolution) => void): void {
        this.onSourceResolved = cb
    }

    /**
     * Whether transcription passes are getting through. Fired on the transition
     * into failure (first failed pass — typically the inference service being
     * unreachable, surfacing as a gRPC deadline/UNAVAILABLE) and on recovery
     * (the next pass that succeeds). Lets the session stop billing and the user
     * see why no notes appear, instead of an audio take that silently burns
     * credits against a dead model.
     */
    setOnHealth(cb: (health: PipelineHealth) => void): void {
        this.onHealth = cb
    }

    setArchiver(archiver: PipelineArchive): void {
        this.archiver = archiver
    }

    appendChunk(buffer: Buffer): void {
        if (!this.timings.firstChunkAt) this.timings.firstChunkAt = Date.now()
        this.chunkBytes += buffer.byteLength
        // Stream the encoded audio to storage as it arrives — never buffered
        // toward a whole-take upload, so memory stays flat for any take length.
        this.archiver?.appendAudio(buffer)
        // The encoded stream is kept for the whole session: it seeds the decoder
        // (container header first) and it is what the final pass re-decodes when it
        // has to re-route a take whose prefix held no pitch (`rerouteFinal`). Cheap —
        // a few MB per hour at browser Opus bitrates.
        this.chunks.push(buffer)
        // Once the decoder is live, forward each chunk straight into it so the byte
        // is decoded once. Chunks buffered before the decoder spawned are fed in one
        // shot at spawn time (see `process`), so this only ever runs for new audio.
        this.streamDecoder?.write(buffer)
        this.scheduleProcess()
    }

    /** Seconds of audio decoded so far — the session's billing meter reads this. */
    get audioDurationSec(): number {
        return this.streamDecoder?.durationSec ?? 0
    }

    async finalize(): Promise<void> {
        if (this.debounceTimer) {
            clearTimeout(this.debounceTimer)
            this.debounceTimer = null
        }
        this.finalRequested = true
        await this.kick()
        await this.archive()
        this.logTimings()
    }

    private scheduleProcess(): void {
        if (this.debounceTimer) return
        this.debounceTimer = setTimeout(() => {
            this.debounceTimer = null
            void this.kick()
        }, DEBOUNCE_MS)
    }

    private async kick(): Promise<void> {
        if (this.processing) {
            this.rerunRequested = true
            return
        }
        this.processing = true
        try {
            do {
                this.rerunRequested = false
                const isFinal = this.finalRequested
                if (isFinal) this.finalRequested = false
                const start = Date.now()
                try {
                    await this.process(isFinal)
                    if (this.consecutiveFailures > 0) {
                        this.logger.log(`Transcription recovered after ${this.consecutiveFailures} failed pass(es)`)
                        this.consecutiveFailures = 0
                        this.onHealth({ ok: true })
                    }
                } catch (err) {
                    this.logger.warn(`Process pass failed: ${describeError(err)}`)
                    if (err instanceof Error && err.stack) {
                        this.logger.warn(err.stack)
                    }
                    this.consecutiveFailures += 1
                    if (this.consecutiveFailures === 1) this.onHealth({ ok: false, message: describeError(err) })
                }
                const elapsed = Date.now() - start
                this.timings.processCount += 1
                this.timings.processTotalMs += elapsed
                if (this.timings.passMs.length < 100_000) this.timings.passMs.push(elapsed)
                if (elapsed > this.timings.processMaxMs) {
                    this.timings.processMaxMs = elapsed
                }
            } while (this.rerunRequested || this.finalRequested)
        } finally {
            this.processing = false
        }
    }

    private async process(isFinal: boolean): Promise<void> {
        if (!this.chunkBytes) return

        const tStart = Date.now()

        // Lock the adaptive profile (provider + frequency window + high-pass) from
        // the first audio before doing any real transcription. Until it resolves we
        // emit nothing — the first real emission lands shortly after, invisible to
        // the user.
        if (!this.converter || !this.profile) {
            await this.resolveProfile(Buffer.concat(this.chunks), isFinal)
        } else if (isFinal && FINAL_REROUTE && this.profile.fallback && this.streamDecoder) {
            // The take was locked on the unvoiced fallback (a lead-in longer than
            // DETECT_MAX_WAIT_SEC). Now that the whole take exists, ask the resolver
            // again — a real register band beats a blind window every time.
            await this.rerouteFinal()
        }
        const converter = this.converter
        const profile = this.profile
        if (!converter || !profile) return
        const provider = converter.provider

        // Spawn the long-lived decoder once the profile is locked, seeding it with
        // every chunk buffered so far (it must see the container header first).
        // From here `appendChunk` forwards new chunks straight in — each byte is
        // decoded exactly once instead of re-decoding the whole stream every pass.
        if (!this.streamDecoder) {
            this.streamDecoder = this.spawnDecoder()
        }

        // On the final pass, flush ffmpeg (incl. any filter look-ahead tail) and take
        // the complete PCM; otherwise take a stable snapshot of what's decoded so far.
        const full = isFinal ? await this.streamDecoder.finalize() : this.streamDecoder.samples()
        if (!full.length) return
        if (!this.timings.firstDecodeAt) this.timings.firstDecodeAt = Date.now()
        const tDecode = Date.now()

        const duration = full.length / provider.sampleRate

        const extracted = await converter.convert(full, this.bpm)
        const tConvert = Date.now()
        this.emitFromExtracted(extracted, duration, isFinal)
        const tEnd = Date.now()

        // A re-routed final pass that found no notes at all still owes the client a
        // rebuild: the measures it emitted under the wrong profile must be cleared.
        if (isFinal && this.reemitAll) this.emitAllMeasures()

        this.logger.debug(
            `Pass timings: decode-wait=${tDecode - tStart}ms, ` +
                `convert=${tConvert - tDecode}ms, ` +
                `emit=${tEnd - tConvert}ms, ` +
                `total=${tEnd - tStart}ms ` +
                `(audioDur=${duration.toFixed(2)}s, ` +
                `samples=${full.length}, final=${isFinal})`,
        )
    }

    /**
     * Run the coarse pitch scan on the current buffer and lock the resulting
     * profile + matching converter. Returns whether a profile is now available.
     * Waits for at least `DETECT_MIN_SEC` of audio unless this is the final pass.
     */
    private async resolveProfile(buffer: Buffer, isFinal: boolean): Promise<boolean> {
        const detected = await this.detectProfile(buffer, isFinal ? 0 : DETECT_MIN_SEC, 'Detection decode not ready')
        if (!detected) return false
        const { profile, durationSec } = detected
        // No reliable pitch yet (breath, a late start, speech): keep listening
        // rather than lock the blind fallback for the whole take. Nothing is lost by
        // waiting — there are no notes to emit before the first pitched audio.
        if (!isFinal && profile.fallback && durationSec < DETECT_MAX_WAIT_SEC) {
            this.logger.debug(`No pitched audio in the first ${durationSec.toFixed(1)} s — profile lock deferred`)
            return false
        }
        this.lockProfile(profile)
        return true
    }

    /**
     * The detection half shared by the lock and the final re-route: decode the
     * encoded take so far at the resolver's input contract and resolve a profile
     * from it. Null when ffmpeg cannot decode it yet (logged under `failure`) or
     * when it holds less than `minSec` of audio — checked BEFORE resolving, which
     * runs the pitch scan, the reverberance estimate and the source classifier.
     */
    private async detectProfile(
        buffer: Buffer,
        minSec: number,
        failure: string,
    ): Promise<{ profile: PipelineProfile; durationSec: number } | null> {
        let detect
        try {
            detect = await this.decoder.decode(buffer, DETECT_SAMPLE_RATE, { ...DETECT_DECODE, inputFormat: this.inputFormat })
        } catch (err) {
            this.logger.debug(`${failure} (${describeError(err)})`)
            return null
        }
        if (detect.duration < minSec) return null
        const profile = this.resolver.resolve(detect.samples, DETECT_SAMPLE_RATE, {
            instrumentId: this.instrumentHint,
            sourceKind: this.sourceKind,
        })
        return { profile, durationSec: detect.duration }
    }

    /**
     * Commit to `profile` as the session's routing: build the converter for its
     * provider, rebuild the builder for its spelling, and tell the client.
     */
    private lockProfile(profile: PipelineProfile): void {
        this.profile = profile
        this.converter = new AudioConverter(this.registry.get(profile.providerName), { profile })
        this.logger.log(
            `Adaptive profile locked: ${profile.id} provider=${profile.providerName} ` +
                `window=${profile.minFreqHz.toFixed(0)}-${profile.maxFreqHz.toFixed(0)}Hz ` +
                `hp=${profile.highpassHz.toFixed(0)}Hz seg=${profile.segmentMode ?? 'default'} ` +
                `(hint=${this.instrumentHint ?? 'none'}, source=${this.sourceKind ?? 'auto'}, ` +
                `decidedBy=${profile.sourceDecidedBy ?? 'n/a'})`,
        )
        // Sung takes are SPELLED on their own tuning grid at the notation layer
        // (voice-notation.ts); the flag lives on the builder, which setMeta may
        // have created before the profile existed — so rebuild it here too.
        this.builder = this.createBuilder()
        // Tell the client what the pipeline believes it is hearing — the user is
        // the one observer who can tell us when this is wrong. `sourceBelief`, not
        // `isVoice`: belief is the observation, `isVoice` the routing outcome, and
        // they can diverge (e.g. the pitch-down very-high band never routes voice).
        this.onSourceResolved({
            source: profile.sourceBelief ?? (profile.isVoice ? 'voice' : 'instrument'),
            decidedBy: profile.sourceDecidedBy ?? 'prior',
        })
    }

    /**
     * A long-lived decoder for the locked profile and its provider, seeded with
     * every chunk buffered so far (it must see the container header first).
     */
    private spawnDecoder(): StreamingDecoder {
        const { profile, converter } = this
        if (!profile || !converter) throw new Error('spawnDecoder called before a profile was locked')
        const provider = converter.provider
        const decoder = new StreamingDecoder(provider.sampleRate, {
            ...AudioConverter.decodeOptionsFor(provider, profile),
            inputFormat: this.inputFormat,
        })
        decoder.write(Buffer.concat(this.chunks))
        return decoder
    }

    /**
     * Final-pass escape from the unvoiced fallback: re-resolve over the WHOLE take
     * and, if a real register band comes back, transcribe the take again under it.
     *
     * Everything emitted so far came from a profile chosen without hearing a single
     * pitched frame, so it is discarded: the emitted-note set and its dedup keys
     * reset, a fresh decoder is seeded from the retained encoded stream
     * (the new profile may change the sample rate, high-pass or denoise chain), and
     * `reemitAll` makes the final emission rebuild every measure — including bars
     * that are now empty. The cost is one extra full-take inference at stop, paid
     * only on takes whose first `DETECT_MAX_WAIT_SEC` held no pitch, where the
     * alternative was a score the fallback measured as empty anyway.
     */
    private async rerouteFinal(): Promise<void> {
        if (!this.streamDecoder) return
        const detected = await this.detectProfile(Buffer.concat(this.chunks), 0, 'Final re-resolve decode failed')
        if (!detected) return
        const { profile } = detected
        if (profile.fallback) return // still nothing pitched — keep what we have

        this.logger.log(
            `Final pass re-routes the take: ${this.profile?.id ?? 'none'} → ${profile.id} ` +
                `(no pitched audio in the first ${DETECT_MAX_WAIT_SEC} s)`,
        )
        // Let the old ffmpeg drain and exit; its PCM is not needed any more.
        void this.streamDecoder.finalize().catch(() => undefined)
        this.lockProfile(profile)
        this.streamDecoder = this.spawnDecoder()
        this.emittedNotes.length = 0
        this.emittedKeys.clear()
        this.reemitAll = true
    }

    /** Rebuild and send every measure emitted so far from the current note set. */
    private emitAllMeasures(): void {
        this.reemitAll = false
        if (this.lastEmittedMeasure < 0) return
        this.onUpdate({ measures: this.builder.buildMeasures(RecordingPipeline.barsThrough(this.lastEmittedMeasure), this.emittedNotes) })
    }

    /** Bar indices 0 … `last`, inclusive. */
    private static barsThrough(last: number): number[] {
        return Array.from({ length: last + 1 }, (_, m) => m)
    }

    /**
     * Fold one pass's extracted notes into the emitted set: a note is committed
     * once it ends `STABLE_MARGIN_SEC` before the decoded audio does (the final
     * pass commits to the very end), and is emitted once, keyed on onset + pitch.
     */
    private emitFromExtracted(extracted: ExtractedNotes, duration: number, isFinal: boolean): void {
        const { raw, deduced } = extracted
        if (!raw.length && !deduced.length) return

        this.lastRawNotes = raw
        this.lastDuration = duration
        const cutoff = duration - (isFinal ? 0 : STABLE_MARGIN_SEC)

        const newNotes: PendingNote[] = []
        for (const n of deduced) {
            if (n.startTimeSeconds + n.durationSeconds > cutoff) continue
            const key = `${Math.round(n.startTimeSeconds * 1000)}_${n.pitchMidi}`
            if (this.emittedKeys.has(key)) continue
            this.emittedKeys.add(key)
            newNotes.push({
                startTimeSeconds: n.startTimeSeconds,
                durationSeconds: n.durationSeconds,
                pitchMidi: n.pitchMidi,
                // The voice decoder's unrounded pitch — the builder spells sung takes
                // on the take's own tuning grid from it (voice-notation.ts). This copy
                // is field-by-field, so forgetting the field here silently reverts
                // voice spelling to absolute names; it did, once.
                pitchMidiFloat: n.pitchMidiFloat,
            })
        }
        if (!newNotes.length) return

        this.emittedNotes.push(...newNotes)
        this.emittedNotes.sort((a, b) => a.startTimeSeconds - b.startTimeSeconds)

        const affected = new Set(this.affectedMeasures(newNotes))
        // Voice spelling is a TAKE-GLOBAL decision: the tuning offset (and the
        // key's vote on the naming) is estimated over every note so far, so early
        // measures were spelled from a half-built estimate. The final pass knows
        // the whole take — re-emit everything so the score the user keeps is
        // spelled from one consistent grid.
        // Likewise after a final-pass re-route: every earlier measure was built
        // from notes the wrong profile produced.
        if (isFinal && (this.profile?.isVoice || this.reemitAll)) {
            for (let m = 0; m <= this.lastEmittedMeasure; m += 1) affected.add(m)
            this.reemitAll = false
        }
        const measures = this.builder.buildMeasures(
            [...affected].sort((a, b) => a - b),
            this.emittedNotes,
        )
        if (!this.timings.firstUpdateAt) this.timings.firstUpdateAt = Date.now()
        this.onUpdate({ measures })
    }

    /**
     * Which measures must be rebuilt for a batch of newly committed notes.
     *
     * Two things beyond "the bar each note starts in", both of which were previously
     * missing and both of which lose music:
     *
     *  - **Every bar a note sounds through.** A held note is written into each bar it
     *    spans, tied across the barlines, so all of them change. Keying off the onset
     *    alone truncated any note longer than a bar — a note held for five bars was
     *    emitted as one.
     *  - **Bars containing nothing at all.** A bar the performer rested through has no
     *    onset to key off, so it was never emitted and the score simply had a hole
     *    where a bar of rest belonged. `buildMeasure` already renders it correctly (a
     *    whole rest) once asked, so the watermark below makes sure it is asked.
     */
    private affectedMeasures(newNotes: PendingNote[]): number[] {
        const affected = new Set<number>()
        let lowest = Infinity
        for (const n of newNotes) {
            const [first, last] = this.builder.measureRangeFor(n.startTimeSeconds, n.durationSeconds)
            for (let m = first; m <= last; m += 1) affected.add(m)
            lowest = Math.min(lowest, first)
            this.lastEmittedMeasure = Math.max(this.lastEmittedMeasure, last)
        }
        // Fill every bar from the first never-emitted one through this batch's end.
        // Two kinds of silent bar hide in that range: bars the performer rested
        // through since the previous batch, and bars BETWEEN two notes of this batch
        // (one burst pass can commit notes spanning a multi-bar rest — filling only
        // up to the batch's lowest bar left those interior bars as holes). Bars the
        // range re-adds that were already emitted just rebuild idempotently.
        if (Number.isFinite(lowest)) {
            const from = Math.min(this.firstUnemittedMeasure, lowest)
            for (let m = from; m <= this.lastEmittedMeasure; m += 1) affected.add(m)
        }
        this.firstUnemittedMeasure = this.lastEmittedMeasure + 1
        return [...affected].sort((a, b) => a - b)
    }

    private logTimings(): void {
        const t = this.timings
        if (!t.firstChunkAt) return
        const totalBytes = this.chunkBytes
        const relativeTo = (at: number): string => (at ? `${at - t.firstChunkAt}ms` : 'never')
        const avgPassMs = t.processCount ? Math.round(t.processTotalMs / t.processCount) : 0
        const totalMs = Date.now() - t.firstChunkAt
        this.logger.debug(
            `Session timings: first-response=${relativeTo(t.firstUpdateAt)}, ` +
                `first-decode=${relativeTo(t.firstDecodeAt)}, ` +
                `passes=${t.processCount} (avg=${avgPassMs}ms, max=${t.processMaxMs}ms), ` +
                `total=${totalMs}ms, chunks=${this.chunks.length} (${totalBytes} bytes)`,
        )
    }

    /**
     * Close out the archive: finish the streaming audio upload and store the
     * debug bundle (pitch plot, emitted score, session metadata) beside it.
     * Idempotent — `finalize` can run more than once (end message + close).
     */
    private archive(): Promise<void> {
        if (!this.archiver) return Promise.resolve()
        // Memoise the in-flight promise rather than a boolean: the end message and
        // the socket close both call finalize(), and the second caller (the session's
        // close(), which persists the audio key) must wait for the upload to finish.
        this.archivePromise ??= this.doArchive()
        return this.archivePromise
    }

    private async doArchive(): Promise<void> {
        if (!this.archiver) return
        await this.archiver.finalize(this.debugBundle())
    }

    /**
     * The take's debug bundle as of now: the pitch plot, every bar of the emitted
     * score and the session metadata. Pure assembly — writing it is the archive's job.
     */
    debugBundle(): DebugBundle {
        let plotSvg: string | undefined
        if (this.lastDuration > 0 || this.lastRawNotes.length) {
            plotSvg = new RecordingDebugRenderer().render({
                rawNotes: this.lastRawNotes,
                deducedNotes: this.emittedNotes,
                durationSec: this.lastDuration,
                bpm: this.bpm,
                beatsPerMeasure: (this.beats * 4) / this.beatType,
            })
        }

        let scoreJson: string | undefined
        if (this.emittedNotes.length) {
            // The archive is a whole take, so it is every bar from the first to the last —
            // including bars that only carry a held note's continuation and bars the
            // performer rested through. Keying off note onsets (as this did) dropped both.
            let highest = 0
            for (const n of this.emittedNotes) {
                const [, last] = this.builder.measureRangeFor(n.startTimeSeconds, n.durationSeconds)
                highest = Math.max(highest, last)
            }
            const measures = this.builder.buildMeasures(RecordingPipeline.barsThrough(highest), this.emittedNotes)
            scoreJson = JSON.stringify({ measures }, null, 2)
        }

        return {
            plotSvg,
            scoreJson,
            sessionMeta: {
                bpm: this.bpm,
                beats: this.beats,
                beatType: this.beatType,
                chromaticTranspose: this.chromaticTranspose,
                instrumentHint: this.instrumentHint ?? null,
                sourceKind: this.sourceKind ?? null,
                profile: this.profile
                    ? {
                          id: this.profile.id,
                          provider: this.profile.providerName,
                          segmentMode: this.profile.segmentMode ?? null,
                          isVoice: this.profile.isVoice ?? false,
                          // Debuggability of mis-routing: what the resolver believed was at
                          // the mic and on which evidence — 'explicit' (client declared),
                          // 'classifier' (audio verdict), or 'prior' (score instrument;
                          // also the classifier-abstain fallback). `isVoice` above is the
                          // routing outcome; belief and routing can diverge (e.g. on the
                          // very-high band, which never takes the voice overlay).
                          sourceBelief: this.profile.sourceBelief ?? null,
                          sourceDecidedBy: this.profile.sourceDecidedBy ?? null,
                      }
                    : null,
                audioDurationSec: this.lastDuration,
                emittedNoteCount: this.emittedNotes.length,
                rawNotes: this.lastRawNotes,
                emittedNotes: this.emittedNotes,
                timings: this.timings,
            },
        }
    }
}
