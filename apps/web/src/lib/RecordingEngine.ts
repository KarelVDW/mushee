import type { Score } from '@/model/Score'

import { MidiPlayer } from './MidiPlayer'
import type { Tickable } from './Ticker'

const DEFAULT_BPM = 90
const CHUNK_MS = 100

export type RecordingState = 'idle' | 'countoff' | 'recording'

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
        this.options = options
        this.stream = await navigator.mediaDevices.getUserMedia({ audio: true })

        const measure = options.score.measures[options.startMeasureIndex]
        const tempo = this.findActiveTempo(options.score, options.startMeasureIndex)
        this.bpm = tempo?.bpm ?? DEFAULT_BPM
        this.beatsPerMeasure = measure.maxBeats

        this.countoffEndTime = (this.beatsPerMeasure * 60) / this.bpm
        this.lastNewMeasureTriggeredFor = null

        this.paintCursor('#ef4444')
        this.moveCursor(options.startMeasureIndex, 0)

        this._state = 'countoff'
        options.onStateChange(this._state)
    }

    stop(): void {
        if (this._state === 'idle') return

        if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
            try {
                this.mediaRecorder.stop()
            } catch {}
        }
        this.mediaRecorder = null

        this.stream?.getTracks().forEach((t) => t.stop())
        this.stream = null

        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            try {
                this.ws.send(JSON.stringify({ type: 'end' }))
            } catch {}
        }
        this.ws?.close()
        this.ws = null

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

        return false
    }

    private async beginStreaming(): Promise<void> {
        if (!this.stream || !this.options) return

        try {
            this.ws = new WebSocket(this.options.wsUrl)
        } catch {
            return
        }

        await new Promise<void>((resolve) => {
            if (!this.ws) return resolve()
            this.ws.addEventListener('open', () => resolve(), { once: true })
            this.ws.addEventListener('error', () => resolve(), { once: true })
        })

        if (this.ws && this.ws.readyState === WebSocket.OPEN && this.options) {
            const ts = this.options.score.getActiveTimeSignature(this.options.startMeasureIndex)
            this.ws.send(
                JSON.stringify({
                    type: 'meta',
                    bpm: this.bpm,
                    timeSignature: ts ? { beats: ts.beatAmount, beatType: ts.beatType } : null,
                }),
            )
        }

        if (!this.stream) return
        this.mediaRecorder = new MediaRecorder(this.stream)
        this.mediaRecorder.ondataavailable = (e) => {
            if (e.data.size === 0) return
            if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send(e.data)
        }
        this.mediaRecorder.start(CHUNK_MS)
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
