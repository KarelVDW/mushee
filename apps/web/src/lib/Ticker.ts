export interface Tickable {
    /** Reset internal state for a new playback pass. */
    reset(): void
    /** Called each animation frame. Return true when done. */
    tick(): boolean
}

/**
 * Drives a rAF loop and fans out ticks to the Tickable instances of the
 * current pass. Each `play` names exactly the units that pass consists of —
 * there is no ambient set that survives across passes, so a unit can never
 * tick in a mode it doesn't belong to.
 */
export class Ticker {
    private tickables = new Set<Tickable>()

    private _isPlaying = false
    private animationId = 0
    private onFinish: (() => void) | null = null

    get isPlaying() {
        return this._isPlaying
    }

    play(tickables: Iterable<Tickable>, onFinish: () => void) {
        this.stop()
        this.onFinish = onFinish
        this.tickables = new Set(tickables)

        for (const t of this.tickables) t.reset()

        this._isPlaying = true
        this.animationId = requestAnimationFrame(this.tick)
    }

    stop() {
        this._isPlaying = false
        if (this.animationId) {
            cancelAnimationFrame(this.animationId)
            this.animationId = 0
        }
    }

    /** Restart the tick loop without resetting tickable state. */
    resume() {
        if (this._isPlaying) return
        this._isPlaying = true
        this.animationId = requestAnimationFrame(this.tick)
    }

    private tick = () => {
        if (!this._isPlaying) return

        let allDone = true

        for (const t of this.tickables) {
            const done = t.tick()
            if (!done) allDone = false
        }

        if (allDone) {
            this._isPlaying = false
            cancelAnimationFrame(this.animationId)
            this.animationId = 0
            this.onFinish?.()
            return
        }

        this.animationId = requestAnimationFrame(this.tick)
    }

    /** Join `tickable` to the pass in flight (e.g. the metronome toggled on mid-playback). */
    addTickable(tickable: Tickable) {
        this.tickables.add(tickable)
    }

    removeTickable(tickable: Tickable) {
        this.tickables.delete(tickable)
        tickable.reset()
    }
}
