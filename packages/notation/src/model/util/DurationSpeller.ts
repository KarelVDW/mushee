import type { DurationType } from '../../components/types'
import { Duration } from '../Duration'
import type { TimeSignature } from '../TimeSignature'

/** A writable value in sixteenth-note units. Coarsest first, so lookups pick the largest fit. */
interface WrittenValue {
    type: DurationType
    dots: number
    units: number
}

const UNITS_PER_BEAT = 4

const WRITTEN_VALUES: WrittenValue[] = [
    { type: 'w', dots: 0, units: 16 },
    { type: 'h', dots: 1, units: 12 },
    { type: 'h', dots: 0, units: 8 },
    { type: 'q', dots: 1, units: 6 },
    { type: 'q', dots: 0, units: 4 },
    { type: '8', dots: 1, units: 3 },
    { type: '8', dots: 0, units: 2 },
    { type: '16', dots: 0, units: 1 },
]

/**
 * Spells a span of time as written note values, honouring where in the bar it
 * starts. Greedy largest-fit ignores metrical position and produces spellings a
 * musician would not write (three beats from beat 2 of 4/4 as a dotted half that
 * straddles the middle of the bar). Engraving convention instead splits at the
 * strongest metrical boundary the span crosses, tying across the split, so the
 * beat structure stays legible. A span is written as one symbol only when it
 * matches a writable value and begins on a position at least as strong as that
 * value's own alignment — a dotted half is fine at the start of a bar, never
 * from beat 2.
 *
 * Works on the sixteenth grid: anything finer is rounded away, so a span shorter
 * than a sixteenth spells as nothing.
 */
export class DurationSpeller {
    constructor(readonly timeSignature: TimeSignature) {}

    /** Written values for `beats` of time starting `startBeat` into the bar (quarter-note beats). */
    spell(startBeat: number, beats: number): Duration[] {
        return this.spellUnits(Math.round(startBeat * UNITS_PER_BEAT), Math.round(beats * UNITS_PER_BEAT)).map(
            (value) => new Duration({ type: value.type, dots: value.dots }),
        )
    }

    /** Metrical boundary sizes in units, coarsest first — whole units only, so a split is always spellable. */
    private get boundaryLevels(): number[] {
        const beatUnits = (UNITS_PER_BEAT * 4) / this.timeSignature.beatType
        const measureUnits = beatUnits * this.timeSignature.beatAmount
        return [measureUnits, measureUnits / 2, beatUnits, beatUnits / 2, beatUnits / 4].filter((d) => d >= 1 && Number.isInteger(d))
    }

    private spellUnits(start: number, units: number): WrittenValue[] {
        if (units <= 0) return []
        const exact = WRITTEN_VALUES.find((value) => value.units === units)
        if (exact && this.alignsWith(start, exact)) return [exact]

        // Split at the coarsest metrical boundary strictly inside the span.
        for (const level of this.boundaryLevels) {
            const next = Math.ceil((start + 1) / level) * level
            if (next < start + units) return [...this.spellUnits(start, next - start), ...this.spellUnits(next, start + units - next)]
        }
        // No interior boundary: the span sits inside one grid cell, so write the largest
        // value that fits and may stand at this position (a sixteenth always can), then the rest.
        const fit = WRITTEN_VALUES.find((value) => value.units <= units && this.alignsWith(start, value)) as WrittenValue
        return [fit, ...this.spellUnits(start + fit.units, units - fit.units)]
    }

    /**
     * Whether a value may be written as a single symbol at `start`: an undotted value
     * needs a position that is a multiple of its own length, a dotted value is governed
     * by its undotted base, and anything is legal at the start of a bar.
     */
    private alignsWith(start: number, value: WrittenValue): boolean {
        if (start === 0) return true
        const base = value.dots > 0 ? (value.units * 2) / 3 : value.units
        return start % base === 0
    }
}
