import type { ScoreScheduler, TimelineEntry } from './ScoreScheduler'
import type { Tickable } from './Ticker'

interface PlaybackPosition {
    measureIndex: number
    beat: number
}

export class CursorManager implements Tickable {
    private cursorEl: SVGRectElement | null = null
    private resolvePosition: ((pos: PlaybackPosition) => { x: number; rowY: number } | null) | null = null
    private scheduler: ScoreScheduler

    constructor(scheduler: ScoreScheduler) {
        this.scheduler = scheduler
    }

    bind(
        cursorEl: SVGRectElement,
        resolvePosition: (pos: PlaybackPosition) => { x: number; rowY: number } | null,
    ) {
        this.cursorEl = cursorEl
        this.resolvePosition = resolvePosition
    }

    reset() {
        // no internal state to reset — reads from scheduler.entries
    }

    tick(elapsed: number): boolean {
        this.updateCursor(elapsed)

        if (this.scheduler.endTime >= 0 && elapsed >= this.scheduler.endTime) {
            if (this.cursorEl) this.cursorEl.setAttribute('display', 'none')
            return true
        }

        return false
    }

    private updateCursor(elapsed: number) {
        const pos = this.getPositionAtTime(elapsed)
        if (pos && this.cursorEl && this.resolvePosition) {
            const resolved = this.resolvePosition(pos)
            if (resolved) {
                this.cursorEl.setAttribute('x', String(resolved.x - 1.5))
                this.cursorEl.setAttribute('transform', `translate(0, ${resolved.rowY})`)
                this.cursorEl.setAttribute('display', '')
            }
        }
    }

    private getPositionAtTime(elapsed: number): PlaybackPosition | null {
        const entries = this.scheduler.entries
        let current: TimelineEntry | null = null
        for (let i = entries.length - 1; i >= 0; i--) {
            if (entries[i].startTime <= elapsed) {
                current = entries[i]
                break
            }
        }
        if (!current) return null

        const progress = Math.min(1, (elapsed - current.startTime) / current.duration)
        const beat = current.beat + current.beatSpan * progress

        return { measureIndex: current.measureIndex, beat }
    }
}
