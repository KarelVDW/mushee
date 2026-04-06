import { MidiPlayer } from './MidiPlayer'

export interface Tickable {
    /** Reset internal state for a new playback pass. */
    reset(): void
    /** Called each animation frame with the elapsed time in seconds. Return true when done. */
    tick(elapsed: number): boolean
}

/**
 * Drives a rAF loop and fans out ticks to a mutable set of Tickable instances.
 * Owns the MidiPlayer lifecycle (start/stop).
 */
export class Ticker {
    readonly midiPlayer: MidiPlayer
    private tickables = new Set<Tickable>()

    private _isPlaying = false
    private animationId = 0
    private onFinish: (() => void) | null = null

    constructor(midiPlayer: MidiPlayer) {
        this.midiPlayer = midiPlayer
    }

    get isPlaying() {
        return this._isPlaying
    }

    play(onFinish: () => void) {
        this.stop()
        this.onFinish = onFinish

        for (const t of this.tickables) t.reset()

        this.midiPlayer.start()
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
    }

    private tick = () => {
        if (!this._isPlaying) return

        const elapsed = this.midiPlayer.currentTime
        let allDone = true

        for (const t of this.tickables) {
            const done = t.tick(elapsed)
            if (!done) allDone = false
        }

        if (allDone) {
            this._isPlaying = false
            cancelAnimationFrame(this.animationId)
            this.animationId = 0
            this.midiPlayer.stop()
            this.onFinish?.()
            return
        }

        this.animationId = requestAnimationFrame(this.tick)
    }

    addTickable(tickable: Tickable) {
        this.tickables.add(tickable)
    }

    removeTickable(tickable: Tickable) {
        this.tickables.delete(tickable)
        tickable.reset()
    }
}
