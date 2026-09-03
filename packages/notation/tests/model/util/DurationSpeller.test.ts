import { TimeSignature } from '@mushee/notation/model/TimeSignature'
import { DurationSpeller } from '@mushee/notation/model/util/DurationSpeller'
import { describe, expect, it } from 'vitest'

const written = (speller: DurationSpeller, start: number, beats: number) =>
    speller.spell(start, beats).map((d) => `${d.type}${'.'.repeat(d.dots)}`)

describe('DurationSpeller', () => {
    const common = new DurationSpeller(new TimeSignature(4, 4))

    it('writes an aligned span as a single value, dotted values included', () => {
        expect(written(common, 0, 4)).toEqual(['w'])
        expect(written(common, 0, 3)).toEqual(['h.'])
        expect(written(common, 1, 1.5)).toEqual(['q.'])
        expect(written(common, 2, 2)).toEqual(['h'])
        expect(written(common, 0.5, 0.5)).toEqual(['8'])
    })

    it('splits at the strongest metrical boundary the span crosses, coarsest first', () => {
        // Three beats from beat 2: quarter to the middle of the bar, then a half.
        expect(written(common, 1, 3)).toEqual(['q', 'h'])
        // Two beats from beat 2 hide the mid-bar division as a single half — split instead.
        expect(written(common, 1, 2)).toEqual(['q', 'q'])
        // A dotted eighth off the beat splits into the sixteenth that reaches the half-beat, then an eighth.
        expect(written(common, 0.25, 0.75)).toEqual(['16', '8'])
    })

    it('spells nothing for spans shorter than a sixteenth and nothing for empty spans', () => {
        expect(common.spell(0, 0)).toEqual([])
        expect(common.spell(0, 0.1)).toEqual([])
    })

    it('uses the meter for its boundaries (6/8 counts eighths, so off-beat quarters split)', () => {
        const compound = new DurationSpeller(new TimeSignature(6, 8))
        expect(written(compound, 0, 3)).toEqual(['h.'])
        expect(written(compound, 0, 1.5)).toEqual(['q.'])
        expect(written(compound, 0.5, 2)).toEqual(['8', '8', '8', '8'])
        // A quarter on the third eighth sits on a quarter-aligned position, so it stays whole (as the recording pipeline writes it).
        expect(written(compound, 1, 1)).toEqual(['q'])
    })

    it('falls back to the largest value allowed at the position when no boundary lies inside the span', () => {
        // In 2/1 the finest boundary is a quarter, so an off-grid dotted eighth has no interior boundary
        // to split at; the sixteenth is the only value that may stand at its position.
        const broad = new DurationSpeller(new TimeSignature(2, 1))
        expect(written(broad, 0.25, 0.75)).toEqual(['16', '8'])
        expect(written(broad, 0, 8)).toEqual(['w', 'w'])
    })
})
