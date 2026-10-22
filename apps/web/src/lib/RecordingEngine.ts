import { type Measure, Score } from '@mushee/notation/model'
import type { MxmlMeasure } from '@mushee/notation/model/io/MusicXml'
import type { MidiPlayer } from '@mushee/playback/MidiPlayer'
import type { Tickable } from '@mushee/playback/Ticker'

import { Microphone } from './Microphone'
import type { PlaybackCursor } from './PlaybackCursor'
import { type RecordingErrorCode, type RecordingLimitInfo, type TranscriptionMeta, TranscriptionSocket } from './TranscriptionSocket'
import { WaveformMeter } from './WaveformMeter'

const CHUNK_MS = 100

/**
 * Recording formats in preference order. Opus (Chrome: WebM, Firefox: Ogg) is
 * what the transcription pipeline was tuned on; MP4/AAC is the only container
 * Safari's MediaRecorder offers. The negotiated type travels with the `meta`
 * frame so the server's ffmpeg decode doesn't have to guess the container.
 */
const MIME_TYPE_CANDIDATES = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4']
/**
 * Browsers default to voice-call processing on the mic, which mobile devices
 * apply aggressively: noise suppression treats sustained pure tones (whistling,
 * held instrument notes) as background noise and removes them entirely. Ask for
 * the raw signal — these are `ideal` hints, so browsers that can't honor them
 * still return a stream instead of throwing.
 */
const MIC_CONSTRAINTS: MediaStreamConstraints = {
    audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
    },
}
const SAMPLE_INTERVAL_SEC = 1 / 30 // downsample amplitude to ~30Hz for rendering
/** How long stop() waits for the recorder's final chunk before ending the socket anyway. */
const RECORDER_FLUSH_FALLBACK_MS = 1000
/** Trough of the cursor's beat pulse; it snaps to full opacity on every metronome click. */
const PULSE_MIN_OPACITY = 0.35
export type RecordingState = 'idle' | 'countoff' | 'recording'

/** One amplitude sample, anchored to the score position it was captured at. */
export interface WaveformSample {
    /** Time since the recording (post-countoff) began, in ms. */
    timeMs: number
    /** Absolute measure index the sample falls in. */
    measureIndex: number
    /** Beat offset within that measure. */
    beat: number
    /** Normalized amplitude, 0..1. */
    amp: number
}

export interface RecordingOptions {
    score: Score
    /**
     * Index of the take's first recorded measure (an empty one the caller
     * inserted). The count-off occupies no measure: it is one measure's worth of
     * clicks at that measure's meter and tempo, before beat 1.
     */
    startMeasureIndex: number
    /** The score's cursor rect; Transport attaches the take's PlaybackCursor to it. */
    cursorEl: SVGRectElement
    wsUrl: string
    onStateChange: (state: RecordingState) => void
    /** Fired when the cursor is about to run off the last available measure. */
    onNeedNewMeasure: () => void
    /** Fired ~30×/s with a mic amplitude sample anchored to a score position. */
    onSample?: (sample: WaveformSample) => void
    /**
     * Fired when the gateway streams back a score update. Measure keys are
     * 0-based indices relative to the take's first measure (key `0` lives at
     * `startMeasureIndex`). Updates keep arriving after stop() while the server
     * drains the take's tail.
     */
    onScoreUpdate?: (update: { measures: Record<number, MxmlMeasure> }) => void
    /** Fired when the gateway reports the daily recording budget is spent. */
    onLimitReached?: (info: RecordingLimitInfo) => void
    /** Fired when the gateway refuses the recording (e.g. one already running). */
    onRecordingError?: (code: RecordingErrorCode) => void
    /**
     * Fired when the transcription connection can't be established or dies
     * mid-take. Without surfacing this, the user keeps singing into a dead
     * socket while the UI still looks live.
     */
    onConnectionLost?: () => void
    /**
     * Transcription health from the server: `ok: false` when its inference
     * backend stops answering (audio is still archived, credits are not metered
     * meanwhile), `ok: true` when it recovers. Surface it — a take that shows
     * waveform bars but never notes must not look like the user's fault.
     */
    onHealth?: (health: { ok: boolean }) => void
    /**
     * Fired exactly once per take, when nothing more can reach the score: the
     * socket closed after stop() (the server's recording-complete, a server
     * close, or the drain timeout), stop() found no open socket to drain, or
     * start() failed or lost the race with stop(). Late {@link onScoreUpdate}s
     * only ever arrive before it.
     */
    onDrained?: () => void
}

/**
 * One recording take: the mic, the count-off and the moving cursor, capture
 * into a MediaRecorder streamed through a {@link TranscriptionSocket}, and the
 * live waveform from a {@link WaveformMeter}. As a Tickable it reads the shared
 * clock that Transport runs — together with the metronome that clicks the
 * count-off and the take — and turns it into the take's position in the score.
 * The lifecycle is driven by start()/stop(), so the engine has no ticker reset.
 */
export class RecordingEngine implements Tickable {
    private _state: RecordingState = 'idle'
    private options: RecordingOptions | null = null

    private midiPlayer: Pick<MidiPlayer, 'currentTime'>
    private bpm = Score.DEFAULT_BPM
    /** Quarter-note length of the felt beat the count-off clicks on (1 in 4/4, 1.5 in 6/8). */
    private pulseBeats = 1
    private countoffEndTime = 0
    /** The take's first measure; the recording's beat 0 is its downbeat. */
    private startMeasure: Measure | null = null
    private lastNewMeasureTriggeredFor: number | null = null

    private stream: MediaStream | null = null
    private mediaRecorder: MediaRecorder | null = null
    /** Negotiated MediaRecorder MIME type; travels to the server in `meta`. */
    private mimeType: string | null = null
    /** The take's socket; null before connecting, once its connection failed or dropped, and after stop(). */
    private socket: TranscriptionSocket | null = null
    private meter: WaveformMeter | null = null
    private lastSampleTime = -Infinity
    /** Bumped by every start()/stop() so an in-flight start (awaiting the mic
     *  permission prompt) can detect it lost the race and release the stream. */
    private lifecycle = 0
    /** The running take's {@link RecordingOptions.onDrained}, fire-once; stop() hands it to the drain. */
    private drained: (() => void) | null = null

    constructor(
        midiPlayer: Pick<MidiPlayer, 'currentTime'>,
        private readonly cursor: PlaybackCursor,
    ) {
        this.midiPlayer = midiPlayer
    }

    get state(): RecordingState {
        return this._state
    }

    /**
     * Begin a take: open the mic, enter the count-off and connect the socket.
     * The caller inserts the empty measure at `startMeasureIndex` beforehand and
     * then runs the clock (`midiPlayer.start()` and the Ticker, with the
     * metronome) — Transport.record does both.
     *
     * Resolves to the mic settings the browser actually granted for the take
     * (`null` when stop() won the permission race or the stream has no audio
     * track). {@link MIC_CONSTRAINTS} are only hints: devices that force voice
     * processing back on are the ones that switch into a call-style audio route
     * and duck playback — surfaced so telemetry can measure how common that is.
     */
    async start(options: RecordingOptions): Promise<MediaTrackSettings | null> {
        const token = ++this.lifecycle
        this.options = options
        const drained = RecordingEngine.once(options.onDrained)

        // The mic declares the record session before it opens, so iOS routes output
        // correctly from the start; stop() ends it (including a stop() racing the prompt).
        let stream: MediaStream
        try {
            stream = await Microphone.open(MIC_CONSTRAINTS)
        } catch (err) {
            if (this.lifecycle === token) this.options = null
            drained()
            throw err
        }
        if (this.lifecycle !== token) {
            // stop() ran while the permission prompt was open and already ended the
            // session; without this the stream is never stopped and the mic indicator stays lit.
            Microphone.stopTracks(stream)
            drained() // the take never ran, so there is nothing to drain
            return null
        }
        this.stream = stream
        this.drained = drained

        const measure = options.score.measures[options.startMeasureIndex]
        this.startMeasure = measure
        this.bpm = options.score.bpmAtBeat(measure, 0)
        const beatsPerMeasure = measure.maxBeats
        this.pulseBeats = measure.timeSignature.pulse.beats
        // The take's meta frame, bar the MIME type connect() negotiates.
        const meta: Omit<TranscriptionMeta, 'mimeType'> = {
            bpm: this.bpm,
            timeSignature: { beats: measure.timeSignature.beatAmount, beatType: measure.timeSignature.beatType },
            // Score notes are stored as written pitch; the mic captures sounding pitch.
            // The server subtracts this from each detected MIDI to land in written-pitch space.
            chromaticTranspose: options.score.instrument.chromaticTranspose,
            // Hint for the server's adaptive pitch profile (frequency window etc.).
            // Auto-detection from the audio remains authoritative — including
            // for voice vs instrument, which the server now classifies from
            // the audio itself (stock YAMNet, no fitted head) and only falls
            // back to this instrument's family when the classifier abstains.
            // Deliberately NO sourceKind here: sending one would override the
            // classifier with a guess that is wrong exactly in the case that
            // matters (singing a line into an instrument staff).
            instrumentId: options.score.instrument.id,
            // Key signature at the take's start measure: sung takes are
            // spelled on the singer's own tuning grid server-side, and the
            // key breaks the remaining ties (F♯ vs G♭-territory notes sung
            // between keys). The score is the one place that knows it.
            keyFifths: measure.keySignature.fifths,
        }

        this.countoffEndTime = (beatsPerMeasure * 60) / this.bpm
        this.lastNewMeasureTriggeredFor = null

        this.meter = new WaveformMeter(stream)
        this.lastSampleTime = -Infinity

        this.cursor.setTone('recording')
        this.cursor.moveTo(options.score, options.startMeasureIndex, 0)

        this._state = 'countoff'
        options.onStateChange(this._state)

        // Connect NOW, during the count-off, not at beat 1. The handshake is a
        // full round trip to the API (TCP + TLS + HTTP upgrade); previously it was
        // awaited *after* the count-off ended and before MediaRecorder.start(), so
        // its entire latency was audio that never got captured — and the server,
        // which treats its first sample as beat 1, then notated every note early by
        // that amount. Over the internet that is 100-400 ms; at 120 bpm a beat is
        // 500 ms, so it could shift a whole take by most of a beat. The count-off
        // is at least a measure long, which is ample slack for the handshake.
        void this.connect(options, meta)
        return stream.getAudioTracks()[0]?.getSettings() ?? null
    }

    stop(): void {
        // Invalidate any start() still awaiting the permission prompt, even
        // when nothing else is running yet — and return the audio session to
        // its default, since such a start() has already declared its intent.
        this.lifecycle++
        Microphone.endSession()
        if (this._state === 'idle') return

        // The socket stops counting for the take now (anything still queued belongs
        // to the take being abandoned), but only ends once the recorder has flushed.
        const socket = this.socket
        this.socket = null
        socket?.retire()
        const recorder = this.mediaRecorder
        this.mediaRecorder = null
        const drained = this.drained ?? (() => {})
        this.drained = null

        // MediaRecorder.stop() flushes its final ≤100 ms chunk asynchronously
        // (the ondataavailable handler holds its own reference to the socket),
        // so only end the socket once that flush has happened. The take has
        // drained once the socket closes — or right away when there is none.
        let finished = false
        const finish = () => {
            if (finished) return
            finished = true
            if (socket) socket.end(drained)
            else drained()
        }
        if (recorder && recorder.state !== 'inactive') {
            recorder.onstop = finish
            // Safety net for browsers that never fire onstop.
            setTimeout(finish, RECORDER_FLUSH_FALLBACK_MS)
            try {
                recorder.stop()
            } catch {
                finish()
            }
        } else {
            finish()
        }

        if (this.stream) Microphone.stopTracks(this.stream)
        this.stream = null

        this.meter?.close()
        this.meter = null

        this.cursor.hide()
        this.cursor.setOpacity(null)
        this.cursor.setTone('playback')
        this.startMeasure = null

        this._state = 'idle'
        const callback = this.options?.onStateChange
        this.options = null
        callback?.(this._state)
    }

    tick(): boolean {
        if (!this.options || !this.startMeasure || this._state === 'idle') return true

        const elapsed = this.midiPlayer.currentTime

        if (this._state === 'countoff') {
            if (elapsed >= this.countoffEndTime) {
                this._state = 'recording'
                this.options.onStateChange(this._state)
                // The moving cursor is its own beat feedback from here on.
                this.cursor.setOpacity(null)
                this.startCapture()
            } else {
                this.pulseCursor(elapsed)
            }
            return false
        }

        const recordingElapsed = elapsed - this.countoffEndTime
        const beatInRecording = (recordingElapsed * this.bpm) / 60

        const pos = this.options.score.positionAfter(this.startMeasure, beatInRecording)
        if (!pos) {
            this.options.onNeedNewMeasure()
            return false
        }
        const measureIndex = pos.measure.index

        this.cursor.moveTo(this.options.score, measureIndex, pos.beat)

        if (pos.beat >= pos.measure.maxBeats - 1 && this.lastNewMeasureTriggeredFor !== measureIndex) {
            this.lastNewMeasureTriggeredFor = measureIndex
            this.options.onNeedNewMeasure()
        }

        this.sampleAmplitude(recordingElapsed, measureIndex, pos.beat)

        return false
    }

    /** Emit one waveform sample anchored to the take's position, at most ~30×/s. */
    private sampleAmplitude(recordingElapsed: number, measureIndex: number, beat: number): void {
        if (!this.meter || !this.options?.onSample) return
        if (recordingElapsed - this.lastSampleTime < SAMPLE_INTERVAL_SEC) return
        this.lastSampleTime = recordingElapsed
        this.options.onSample({
            timeMs: Math.round(recordingElapsed * 1000),
            measureIndex,
            beat,
            amp: this.meter.sample(),
        })
    }

    /**
     * Open the take's socket. Runs during the count-off so that nothing
     * asynchronous sits between beat 1 and the first captured sample.
     */
    private async connect(opts: RecordingOptions, meta: Omit<TranscriptionMeta, 'mimeType'>): Promise<void> {
        // Now that connecting happens during the count-off, the user can cancel while
        // the handshake is still in flight. `lifecycle` is the existing token for
        // exactly this race: if it moves, this connect() lost and must stay silent
        // rather than report a connection failure the user caused by pressing stop.
        const token = this.lifecycle
        // Negotiated HERE, before the handshake, because the meta frame usually goes
        // out as soon as the socket opens — during the count-off, before the recorder
        // exists. Picking the type in startCapture() meant that frame carried
        // mimeType: null and the server fell back to probing the container, which is
        // exactly what the hint exists to avoid (a streamed Safari MP4 probes badly).
        const mimeType = RecordingEngine.pickMimeType()
        this.mimeType = mimeType

        let socket: TranscriptionSocket
        try {
            socket = new TranscriptionSocket(opts.wsUrl, {
                // Bound now, not read from this.options: stop() nulls the options
                // while the server is still flushing the take's tail, and those late
                // updates must still land in the score.
                onScoreUpdate: opts.onScoreUpdate,
                // The rest only matter while the take is live.
                onLimitReached: (info) => this.options?.onLimitReached?.(info),
                onRecordingError: (code) => this.options?.onRecordingError?.(code),
                onHealth: (health) => this.options?.onHealth?.(health),
                onConnectionLost: () => {
                    this.socket = null
                    opts.onConnectionLost?.()
                },
            })
        } catch {
            opts.onConnectionLost?.()
            return
        }
        this.socket = socket

        await socket.handshake()
        if (this.lifecycle !== token) {
            // Cancelled during the handshake; stop() already ended the socket.
            socket.close()
            return
        }
        if (!socket.isOpen) {
            socket.markFailed()
            if (this.socket === socket) this.socket = null
            opts.onConnectionLost?.()
            return
        }
        // The socket may have opened after capture already began; anything queued
        // in the meantime goes out now, in order, behind the meta frame.
        socket.sendMeta({ ...meta, mimeType })
    }

    /**
     * Begin capturing, synchronously. Called the moment the count-off ends, so the
     * first encoded sample really is beat 1 — the server derives every note's beat
     * position from this instant, so anything awaited before here becomes a
     * systematic timing error in the finished score.
     *
     * The socket is usually already open (it was started at count-off begin); if it
     * is not, it queues the chunks rather than blocking or dropping them.
     */
    private startCapture(): void {
        if (!this.stream) return
        // connect() drops the socket when the handshake failed and has already
        // reported it; starting a recorder with nowhere to send would just leak.
        const socket = this.socket
        if (!socket) return
        this.mediaRecorder = this.mimeType ? new MediaRecorder(this.stream, { mimeType: this.mimeType }) : new MediaRecorder(this.stream)

        // Captured in the closure, NOT read via `this.socket` per chunk: stop() drops
        // `this.socket` and only then stops the recorder, whose final ≤CHUNK_MS of
        // audio arrives asynchronously afterwards — reading the field at that point
        // would silently drop the tail of every take. The closure keeps the socket
        // for exactly that last flush (it stays open until the server has streamed
        // the take's final notes back).
        this.mediaRecorder.ondataavailable = (e) => {
            if (e.data.size === 0) return
            socket.send(e.data)
        }
        this.mediaRecorder.start(CHUNK_MS)
    }

    /** `callback` wrapped so it runs at most once (a no-op when absent). */
    private static once(callback: (() => void) | undefined): () => void {
        let called = false
        return () => {
            if (called) return
            called = true
            callback?.()
        }
    }

    /**
     * First candidate this browser can record. `null` when nothing matched or
     * `isTypeSupported` is missing (pre-2021 Safari) — then the browser's
     * default encoding is used and the server probes the container instead.
     */
    private static pickMimeType(): string | null {
        if (typeof MediaRecorder.isTypeSupported !== 'function') return null
        return MIME_TYPE_CANDIDATES.find((type) => MediaRecorder.isTypeSupported(type)) ?? null
    }

    /**
     * Blink the cursor in time with the count-off clicks: full opacity on each
     * beat, decaying to a trough — a visual count-in while the cursor has no
     * motion to show yet. Reads the same clock the clicks are scheduled on, so
     * the two can't drift.
     */
    private pulseCursor(elapsed: number): void {
        const beatPhase = ((elapsed * this.bpm) / 60 / this.pulseBeats) % 1
        this.cursor.setOpacity(PULSE_MIN_OPACITY + (1 - PULSE_MIN_OPACITY) * Math.pow(1 - beatPhase, 3))
    }
}
