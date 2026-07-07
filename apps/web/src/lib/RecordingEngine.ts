import type { MxmlMeasure } from '@/components/notation/types'
import type { Score } from '@/model/Score'

import { MidiPlayer } from './MidiPlayer'
import type { Tickable } from './Ticker'

const DEFAULT_BPM = 90
const CHUNK_MS = 100
/**
 * Recording formats in preference order. Opus (Chrome: WebM, Firefox: Ogg) is
 * what the transcription pipeline was tuned on; MP4/AAC is the only container
 * Safari's MediaRecorder offers. The negotiated type travels with the `meta`
 * frame so the server's ffmpeg decode doesn't have to guess the container.
 */
const MIME_TYPE_CANDIDATES = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4']
const SAMPLE_INTERVAL_SEC = 1 / 30 // downsample amplitude to ~30Hz for rendering
/** RMS from typical mic input rarely exceeds ~0.2, so amplify before clamping to 0..1. */
const WAVEFORM_GAIN = 10
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

/** Sent by the gateway when the daily recording budget runs out (or already had). */
export interface RecordingLimitInfo {
    planId: string
    planName: string
    /** Daily budget in seconds; `null` on unlimited tiers (never sent in practice). */
    limitSeconds: number | null
    usedSeconds: number
}

/** Reasons the gateway refuses a recording connection. */
export type RecordingErrorCode = 'score-required' | 'score-not-found' | 'concurrent-recording' | 'beta-pending'

/**
 * Thrown by {@link RecordingEngine.start} when the browser cannot capture audio
 * at all — no `mediaDevices` (ancient browser) or an insecure (non-HTTPS)
 * context, where the API is hidden. Distinct from a permission denial, which
 * surfaces as a `NotAllowedError` DOMException from `getUserMedia` itself.
 */
export class RecordingUnsupportedError extends Error {
    constructor() {
        super('Audio capture is not available in this browser or context')
        this.name = 'RecordingUnsupportedError'
    }
}

export interface ResolveRecordingPosition {
    (measureIndex: number, beat: number): { x: number; rowY: number } | null
}

export interface RecordingOptions {
    score: Score
    /** Index of the freshly inserted empty count-off measure. */
    startMeasureIndex: number
    cursorEl: SVGRectElement
    resolvePosition: ResolveRecordingPosition
    wsUrl: string
    onStateChange: (state: RecordingState) => void
    /** Fired when the cursor is about to run off the last available measure. */
    onNeedNewMeasure: () => void
    /** Fired ~30×/s with a mic amplitude sample anchored to a score position. */
    onSample?: (sample: WaveformSample) => void
    /**
     * Fired when the gateway streams back a score update. Measure keys are
     * 0-based indices relative to the recording start (i.e., the first recording
     * measure is `0`, which in the score lives at `startMeasureIndex + 1`).
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
}

/**
 * Drives the metronome click schedule and the cursor indicator during a recording session.
 * Mic capture + WebSocket streaming is owned here but not driven by the tick loop.
 */
export class RecordingEngine implements Tickable {
    private _state: RecordingState = 'idle'
    private options: RecordingOptions | null = null

    private midiPlayer: MidiPlayer
    private bpm = DEFAULT_BPM
    private beatsPerMeasure = 4
    private countoffEndTime = 0
    private lastNewMeasureTriggeredFor: number | null = null

    private stream: MediaStream | null = null
    private mediaRecorder: MediaRecorder | null = null
    private ws: WebSocket | null = null

    private analyserCtx: AudioContext | null = null
    private analyser: AnalyserNode | null = null
    private analyserData: Uint8Array<ArrayBuffer> | null = null
    private lastSampleTime = -Infinity
    /** Bumped by every start()/stop() so an in-flight start (awaiting the mic
     *  permission prompt) can detect it lost the race and release the stream. */
    private lifecycle = 0

    constructor(midiPlayer: MidiPlayer) {
        this.midiPlayer = midiPlayer
    }

    get state(): RecordingState {
        return this._state
    }

    /**
     * Begin a recording session. Caller is responsible for:
     *   1. inserting the empty count-off measure so `score.measures[startMeasureIndex]` is it
     *   2. inserting the first empty recording measure at `startMeasureIndex + 1`
     *   3. calling `midiPlayer.start()` and running the Ticker afterwards
     */
    async start(options: RecordingOptions): Promise<void> {
        if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
            throw new RecordingUnsupportedError()
        }
        const token = ++this.lifecycle
        this.options = options

        let stream: MediaStream
        try {
            stream = await navigator.mediaDevices.getUserMedia({ audio: true })
        } catch (err) {
            if (this.lifecycle === token) this.options = null
            throw err
        }
        if (this.lifecycle !== token) {
            // stop() ran while the permission prompt was open; without this the
            // stream is never stopped and the mic indicator stays lit.
            stream.getTracks().forEach((t) => t.stop())
            return
        }
        this.stream = stream

        const measure = options.score.measures[options.startMeasureIndex]
        const tempo = this.findActiveTempo(options.score, options.startMeasureIndex)
        this.bpm = tempo?.bpm ?? DEFAULT_BPM
        this.beatsPerMeasure = measure.maxBeats

        this.countoffEndTime = (this.beatsPerMeasure * 60) / this.bpm
        this.lastNewMeasureTriggeredFor = null

        this.analyserCtx = new AudioContext()
        const source = this.analyserCtx.createMediaStreamSource(this.stream)
        this.analyser = this.analyserCtx.createAnalyser()
        this.analyser.fftSize = 256
        source.connect(this.analyser)
        this.analyserData = new Uint8Array(new ArrayBuffer(this.analyser.fftSize))

        this.lastSampleTime = -Infinity

        this.paintCursor('#ef4444')
        this.moveCursor(options.startMeasureIndex, 0)

        this._state = 'countoff'
        options.onStateChange(this._state)
    }

    stop(): void {
        // Invalidate any start() still awaiting the permission prompt, even
        // when nothing else is running yet.
        this.lifecycle++
        if (this._state === 'idle') return

        const ws = this.ws
        this.ws = null
        const recorder = this.mediaRecorder
        this.mediaRecorder = null

        // MediaRecorder.stop() flushes its final ≤100 ms chunk asynchronously
        // (the ondataavailable handler holds its own reference to the socket),
        // so only send `end` and close once that flush has happened — closing
        // here would drop the last moments of every take.
        let finished = false
        const finish = () => {
            if (finished) return
            finished = true
            if (ws && ws.readyState === WebSocket.OPEN) {
                try {
                    ws.send(JSON.stringify({ type: 'end' }))
                } catch {
                    // socket may have closed mid-send; close() below still runs
                }
            }
            ws?.close()
        }
        if (recorder && recorder.state !== 'inactive') {
            recorder.onstop = finish
            // Safety net for browsers that never fire onstop.
            setTimeout(finish, 1000)
            try {
                recorder.stop()
            } catch {
                finish()
            }
        } else {
            finish()
        }

        this.stream?.getTracks().forEach((t) => t.stop())
        this.stream = null

        this.analyserCtx?.close().catch(() => {})
        this.analyserCtx = null
        this.analyser = null
        this.analyserData = null

        if (this.options) {
            this.options.cursorEl.setAttribute('display', 'none')
            this.paintCursor('#3b82f6')
        }

        this._state = 'idle'
        const callback = this.options?.onStateChange
        this.options = null
        callback?.(this._state)
    }

    reset(): void {
        // Lifecycle is driven explicitly by start()/stop(); ignore ticker resets.
    }

    tick(): boolean {
        if (!this.options || this._state === 'idle') return true

        const elapsed = this.midiPlayer.currentTime

        if (this._state === 'countoff') {
            if (elapsed >= this.countoffEndTime) {
                this._state = 'recording'
                this.options.onStateChange(this._state)
                void this.beginStreaming()
            }
            return false
        }

        const recordingElapsed = elapsed - this.countoffEndTime
        const beatInRecording = (recordingElapsed * this.bpm) / 60

        let remaining = beatInRecording
        let measureIndex = this.options.startMeasureIndex

        while (measureIndex < this.options.score.measures.length) {
            const m = this.options.score.measures[measureIndex]
            if (remaining < m.maxBeats) break
            remaining -= m.maxBeats
            measureIndex++
        }

        if (measureIndex >= this.options.score.measures.length) {
            this.options.onNeedNewMeasure()
            return false
        }

        this.moveCursor(measureIndex, remaining)

        const currentMeasure = this.options.score.measures[measureIndex]
        if (remaining >= currentMeasure.maxBeats - 1 && this.lastNewMeasureTriggeredFor !== measureIndex) {
            this.lastNewMeasureTriggeredFor = measureIndex
            this.options.onNeedNewMeasure()
        }

        this.sampleAmplitude(recordingElapsed, measureIndex, remaining)

        return false
    }

    /** Meter the mic (RMS over the analyser window) and emit one anchored sample. */
    private sampleAmplitude(recordingElapsed: number, measureIndex: number, beat: number): void {
        if (!this.analyser || !this.analyserData || !this.options?.onSample) return
        if (recordingElapsed - this.lastSampleTime < SAMPLE_INTERVAL_SEC) return
        this.lastSampleTime = recordingElapsed

        this.analyser.getByteTimeDomainData(this.analyserData)
        let sumSquares = 0
        for (let i = 0; i < this.analyserData.length; i++) {
            const v = (this.analyserData[i] - 128) / 128
            sumSquares += v * v
        }
        const rms = Math.sqrt(sumSquares / this.analyserData.length)
        this.options.onSample({
            timeMs: Math.round(recordingElapsed * 1000),
            measureIndex,
            beat,
            amp: Math.min(rms * WAVEFORM_GAIN, 1),
        })
    }

    private async beginStreaming(): Promise<void> {
        if (!this.stream || !this.options) return
        const opts = this.options

        let ws: WebSocket
        try {
            ws = new WebSocket(opts.wsUrl)
        } catch {
            opts.onConnectionLost?.()
            return
        }
        this.ws = ws

        // A close while this socket is still the engine's and a take is live
        // means the connection died under the user — surface it instead of
        // letting them keep singing into a dead socket.
        ws.addEventListener('close', () => {
            if (this._state !== 'idle' && this.ws === ws) {
                this.ws = null
                opts.onConnectionLost?.()
            }
        })

        await new Promise<void>((resolve) => {
            ws.addEventListener('open', () => resolve(), { once: true })
            ws.addEventListener('error', () => resolve(), { once: true })
        })
        if (ws.readyState !== WebSocket.OPEN) {
            if (this.ws === ws) this.ws = null
            opts.onConnectionLost?.()
            return
        }

        ws.addEventListener('message', (event) => {
            if (typeof event.data !== 'string') return
            let msg: unknown
            try {
                msg = JSON.parse(event.data)
            } catch {
                return
            }
            if (!msg || typeof msg !== 'object') return
            const payload = msg as {
                type?: string
                measures?: Record<number, MxmlMeasure>
                code?: RecordingErrorCode
                planId?: string
                planName?: string
                limitSeconds?: number | null
                usedSeconds?: number
            }
            if (payload.type === 'score-update' && payload.measures) {
                this.options?.onScoreUpdate?.({ measures: payload.measures })
            } else if (payload.type === 'recording-limit') {
                this.options?.onLimitReached?.({
                    planId: payload.planId ?? 'free',
                    planName: payload.planName ?? '',
                    limitSeconds: payload.limitSeconds ?? null,
                    usedSeconds: payload.usedSeconds ?? 0,
                })
            } else if (payload.type === 'recording-error' && payload.code) {
                this.options?.onRecordingError?.(payload.code)
            }
        })

        if (!this.stream) return
        const mimeType = RecordingEngine.pickMimeType()
        this.mediaRecorder = mimeType ? new MediaRecorder(this.stream, { mimeType }) : new MediaRecorder(this.stream)

        if (this.ws && this.ws.readyState === WebSocket.OPEN && this.options) {
            const ts = this.options.score.measures[this.options.startMeasureIndex]?.timeSignature
            this.ws.send(
                JSON.stringify({
                    type: 'meta',
                    bpm: this.bpm,
                    timeSignature: ts ? { beats: ts.beatAmount, beatType: ts.beatType } : null,
                    // Score notes are stored as written pitch; the mic captures sounding pitch.
                    // The server subtracts this from each detected MIDI to land in written-pitch space.
                    chromaticTranspose: this.options.score.instrument.chromaticTranspose,
                    // Hint for the server's adaptive pitch profile (frequency window etc.).
                    // Auto-detection from the audio remains authoritative.
                    instrumentId: this.options.score.instrument.id,
                    // `null` = the browser's default container; the server probes it.
                    mimeType,
                }),
            )
        }

        // Hold the socket directly (not via this.ws): stop() nulls this.ws
        // before the recorder's final flush, and that last chunk must still
        // reach the server.
        this.mediaRecorder.ondataavailable = (e) => {
            if (e.data.size === 0) return
            if (ws.readyState === WebSocket.OPEN) ws.send(e.data)
        }
        this.mediaRecorder.start(CHUNK_MS)
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

    private findActiveTempo(score: Score, measureIndex: number) {
        for (let i = measureIndex; i >= 0; i--) {
            const tempos = [...score.measures[i].tempos].sort((a, b) => b.beatPosition - a.beatPosition)
            if (tempos.length > 0) return tempos[0]
        }
        return null
    }

    private moveCursor(measureIndex: number, beat: number): void {
        if (!this.options) return
        const pos = this.options.resolvePosition(measureIndex, beat)
        if (!pos) return
        this.options.cursorEl.setAttribute('x', String(pos.x - 1.5))
        this.options.cursorEl.setAttribute('transform', `translate(0, ${pos.rowY})`)
        this.options.cursorEl.setAttribute('display', '')
    }

    private paintCursor(color: string): void {
        this.options?.cursorEl.setAttribute('fill', color)
    }
}
