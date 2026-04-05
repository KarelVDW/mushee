import type { Score } from '@/model/Score'

import { MidiPlayer } from './MidiPlayer'
import { type PlaybackPosition, ScoreTransformer, type TimelineEntry } from './ScoreTransformer'

/**
 * Orchestrates score playback: transforms the score into a timeline,
 * delegates audio to MidiPlayer, and drives the cursor animation.
 */
export class ScorePlayer {
    readonly midiPlayer: MidiPlayer
    private transformer = new ScoreTransformer()

    constructor(midiPlayer: MidiPlayer) {
        this.midiPlayer = midiPlayer
    }

    private timeline: TimelineEntry[] = []
    private totalDuration = 0
    private playStartTime = 0
    private _isPlaying = false
    private animationId = 0

    private cursorEl: SVGRectElement | null = null
    private resolvePosition: ((pos: PlaybackPosition) => { x: number; rowY: number } | null) | null = null
    private onFinish: (() => void) | null = null

    get isPlaying() {
        return this._isPlaying
    }

    /** Preload piano samples. Call once on mount. */
    async loadSamples() {
        return this.midiPlayer.loadSamples()
    }

    play(
        score: Score,
        cursorEl: SVGRectElement,
        resolvePosition: (pos: PlaybackPosition) => { x: number; rowY: number } | null,
        onFinish: () => void,
    ) {
        this.stop()
        this.cursorEl = cursorEl
        this.resolvePosition = resolvePosition
        this.onFinish = onFinish

        const { entries, notes, totalDuration } = this.transformer.transform(score)
        this.timeline = entries
        this.totalDuration = totalDuration
        if (entries.length === 0) return

        this.midiPlayer.start(notes)
        this.playStartTime = performance.now() / 1000
        this._isPlaying = true
        this.animationId = requestAnimationFrame(this.tick)
    }

    stop() {
        this._isPlaying = false
        if (this.animationId) {
            cancelAnimationFrame(this.animationId)
            this.animationId = 0
        }

        this.midiPlayer.stop()

        if (this.cursorEl) this.cursorEl.setAttribute('display', 'none')
        this.cursorEl = null
        this.resolvePosition = null
    }

    // --- Animation ---

    private tick = () => {
        if (!this._isPlaying) return

        const elapsed = this.midiPlayer.currentTime

        if (elapsed >= this.totalDuration) {
            this._isPlaying = false
            cancelAnimationFrame(this.animationId)
            this.animationId = 0
            if (this.cursorEl) this.cursorEl.setAttribute('display', 'none')

            this.midiPlayer.stop()
            this.onFinish?.()
            return
        }

        const pos = this.getPositionAtTime(elapsed)
        if (pos && this.cursorEl && this.resolvePosition) {
            const resolved = this.resolvePosition(pos)
            if (resolved) {
                this.cursorEl.setAttribute('x', String(resolved.x - 1.5))
                this.cursorEl.setAttribute('transform', `translate(0, ${resolved.rowY})`)
                this.cursorEl.setAttribute('display', '')
            }
        }

        this.animationId = requestAnimationFrame(this.tick)
    }

    private getPositionAtTime(elapsed: number): PlaybackPosition | null {
        let current: TimelineEntry | null = null
        for (let i = this.timeline.length - 1; i >= 0; i--) {
            if (this.timeline[i].startTime <= elapsed) {
                current = this.timeline[i]
                break
            }
        }
        if (!current) return null

        const progress = Math.min(1, (elapsed - current.startTime) / current.duration)
        const beat = current.beat + current.beatSpan * progress

        return { measureIndex: current.measureIndex, beat }
    }
}
