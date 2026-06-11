export interface BeatPositioned {
    readonly beatPosition: number
}

/**
 * Shared queries for a measure's beat-positioned collections (clefs, key
 * signatures, tempos): the leading item sits at beat 0, later items are
 * mid-measure changes. Wraps a live array accessor so the list always reflects
 * the measure's current state.
 */
export class BeatPositionedList<T extends BeatPositioned> {
    constructor(private readonly items: () => T[]) {}

    /** The item at beat 0, or the earliest item as a fallback. Undefined only when the list is empty. */
    get leading(): T | undefined {
        const items = this.items()
        return items.find((item) => item.beatPosition === 0) ?? items[0]
    }

    /** The last (highest-beat) item — the one carried into the next measure. */
    get last(): T | undefined {
        let latest: T | undefined
        for (const item of this.items()) {
            if (!latest || item.beatPosition > latest.beatPosition) latest = item
        }
        return latest
    }

    /** The item exactly at `beat`, if any. */
    at(beat: number): T | undefined {
        return this.items().find((item) => item.beatPosition === beat)
    }

    /** The item in effect at `beat` — the latest at or before it. */
    atOrBefore(beat: number): T | undefined {
        let active: T | undefined
        for (const item of this.items()) {
            if (item.beatPosition <= beat && (!active || item.beatPosition >= active.beatPosition)) active = item
        }
        return active
    }

    /** The item in effect just before `beat` (ignoring any item exactly at it). */
    before(beat: number): T | undefined {
        let active: T | undefined
        for (const item of this.items()) {
            if (item.beatPosition < beat && (!active || item.beatPosition >= active.beatPosition)) active = item
        }
        return active
    }

    /**
     * Mid-measure items that actually change the active value, in beat order. An item equal
     * to the one already in effect before it is a no-op: kept in the list (so the intent
     * re-emerges if context changes) but not drawn or serialized.
     */
    midMeasureChanges(changes: (active: T, item: T) => boolean): T[] {
        return this.items()
            .filter((item) => {
                if (item.beatPosition <= 0) return false
                const active = this.before(item.beatPosition)
                return active === undefined || changes(active, item)
            })
            .sort((a, b) => a.beatPosition - b.beatPosition)
    }
}
