import type { MidiPlayer } from '@mushee/playback/MidiPlayer'
import type { ScoreScheduler } from '@mushee/playback/ScoreScheduler'
import type { Tickable } from '@mushee/playback/Ticker'

interface PlaybackPosition {
    measureIndex: number
    beat: number
}

export class CursorManager implements Tickable {
    private midiPlayer: Pick<MidiPlayer, 'currentTime'>
    private cursorEl: SVGRectElement | null = null
    private resolvePosition: ((pos: PlaybackPosition) => { x: number; rowY: number } | null) | null = null
    private scheduler: Pick<ScoreScheduler, 'positionAt' | 'hasFinishedAt'>

    constructor(midiPlayer: Pick<MidiPlayer, 'currentTime'>, scheduler: Pick<ScoreScheduler, 'positionAt' | 'hasFinishedAt'>) {
        this.midiPlayer = midiPlayer
        this.scheduler = scheduler
    }

    bind(cursorEl: SVGRectElement, resolvePosition: (pos: PlaybackPosition) => { x: number; rowY: number } | null) {
        this.cursorEl = cursorEl
        this.resolvePosition = resolvePosition
    }

    hideCursor() {
        if (this.cursorEl) this.cursorEl.setAttribute('display', 'none')
    }

    tick(): boolean {
        const elapsed = this.midiPlayer.currentTime
        this.updateCursor(elapsed)

        if (this.scheduler.hasFinishedAt(elapsed)) {
            this.hideCursor()
            return true
        }

        return false
    }

    private updateCursor(elapsed: number) {
        const pos = this.scheduler.positionAt(elapsed)
        if (pos && this.cursorEl && this.resolvePosition) {
            const resolved = this.resolvePosition(pos)
            if (resolved) {
                this.cursorEl.setAttribute('x', String(resolved.x - 1.5))
                this.cursorEl.setAttribute('transform', `translate(0, ${resolved.rowY})`)
                this.cursorEl.setAttribute('display', '')
            }
        }
    }
}
