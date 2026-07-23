/** One live waveform bar: an amplitude sample anchored to a score position. */
export interface WaveformBar {
    /** Sample time in ms since the recording started — unique per take. */
    id: number
    /** Absolute measure index in the score. */
    measureIndex: number
    /** Beat offset within that measure. */
    beat: number
    /** Normalized amplitude, 0..1. */
    amp: number
    /** Stable position in the take's bar sequence (drives the alternating color). */
    seq: number
    /** True once the bar's note arrived and its exit animation is running. */
    exiting: boolean
}

/**
 * Holds the waveform bars of the recording in flight. A tiny external store
 * (subscribe/getSnapshot) so the bars can update at sample rate (~30Hz)
 * re-rendering only the waveform layer, never the whole editor page.
 *
 * Bars are added as the mic meters amplitude, marked `exiting` once the
 * transcription for their timestamp lands on the staff (the component then
 * plays the exit animation), and dropped when that animation finishes.
 */
export class RecordingWaveformStore {
    private bars: WaveformBar[] = []
    private snapshot: readonly WaveformBar[] = []
    private seq = 0
    private readonly listeners = new Set<() => void>()

    subscribe = (listener: () => void): (() => void) => {
        this.listeners.add(listener)
        return () => this.listeners.delete(listener)
    }

    getSnapshot = (): readonly WaveformBar[] => this.snapshot

    private commit(): void {
        this.snapshot = [...this.bars]
        for (const listener of this.listeners) listener()
    }

    add(bar: { id: number; measureIndex: number; beat: number; amp: number }): void {
        this.bars.push({ ...bar, seq: this.seq++, exiting: false })
        this.commit()
    }

    /**
     * Begin the exit animation for every bar the transcription now covers:
     * bars strictly before `beatEnd` in `measureIndex` (earlier measures are
     * covered by their own updates). No-op when nothing matches.
     */
    clearCovered(measureIndex: number, beatEnd: number): void {
        let changed = false
        for (const bar of this.bars) {
            if (bar.exiting || bar.measureIndex !== measureIndex || bar.beat >= beatEnd) continue
            bar.exiting = true
            changed = true
        }
        if (changed) this.commit()
    }

    /** Begin the exit animation for every remaining bar (the take ended). */
    clearAll(): void {
        let changed = false
        for (const bar of this.bars) {
            if (bar.exiting) continue
            bar.exiting = true
            changed = true
        }
        if (changed) this.commit()
    }

    /** Drop a bar whose exit animation finished. */
    remove(id: number): void {
        const before = this.bars.length
        this.bars = this.bars.filter((bar) => bar.id !== id)
        if (this.bars.length !== before) this.commit()
    }

    /** Drop everything immediately (new take starting). */
    reset(): void {
        this.seq = 0
        if (!this.bars.length) return
        this.bars = []
        this.commit()
    }
}
