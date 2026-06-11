import { describe, expect, it } from 'vitest'

import { Score } from '@/model/Score'
import { TimeSignature } from '@/model/TimeSignature'

describe('TimeSignature', () => {
    it('stores beatAmount and beatType', () => {
        const ts = new TimeSignature(4, 4)
        expect(ts.beatAmount).toBe(4)
        expect(ts.beatType).toBe(4)
    })

    it('maxBeats expresses total in quarter-note units', () => {
        expect(new TimeSignature(4, 4).maxBeats).toBe(4)
        expect(new TimeSignature(3, 4).maxBeats).toBe(3)
        expect(new TimeSignature(6, 8).maxBeats).toBe(3)
        expect(new TimeSignature(12, 8).maxBeats).toBe(6)
        expect(new TimeSignature(2, 2).maxBeats).toBe(4)
    })

    it('beatsDigits and beatTypeDigits split into individual digits', () => {
        const ts = new TimeSignature(12, 8)
        expect(ts.beatsDigits).toEqual(['1', '2'])
        expect(ts.beatTypeDigits).toEqual(['8'])
    })

    describe('equals (value-object identity)', () => {
        it('is true for the same digits', () => {
            expect(new TimeSignature(3, 4).equals(new TimeSignature(3, 4))).toBe(true)
        })

        it('is false when the numerator differs', () => {
            expect(new TimeSignature(3, 4).equals(new TimeSignature(4, 4))).toBe(false)
        })

        it('is false when the denominator differs', () => {
            expect(new TimeSignature(3, 4).equals(new TimeSignature(3, 8))).toBe(false)
        })
    })

    it('is shared across measures as a value object (no measure reference)', () => {
        const score = new Score()
        const a = score.addMeasure()
        const b = score.addMeasure() // inherits the previous measure's time signature
        expect(b.timeSignature).toBe(a.timeSignature)
    })

    it('lazily creates a single TimeSignatureWidth instance (cached forever)', () => {
        const ts = new TimeSignature(4, 4)
        expect(ts.width).toBe(ts.width)
    })

    it('lazily creates a single TimeSignatureLayout instance (cached forever)', () => {
        const ts = new TimeSignature(4, 4)
        expect(ts.layout).toBe(ts.layout)
    })

    it('beatUnit is the duration of a single beat (quarter in 4/4, eighth in 6/8)', () => {
        expect(new TimeSignature(4, 4).beatUnit.beats).toBe(1)
        expect(new TimeSignature(6, 8).beatUnit.beats).toBe(0.5)
    })

    describe('fillRests', () => {
        it('returns nothing when the measure is already full', () => {
            expect(new TimeSignature(4, 4).fillRests(4)).toEqual([])
        })

        it('returns nothing when filled beats exceed the maximum', () => {
            expect(new TimeSignature(4, 4).fillRests(5)).toEqual([])
        })

        it('fills a whole empty 4/4 measure with four quarter beats', () => {
            const rests = new TimeSignature(4, 4).fillRests(0)
            expect(rests).toHaveLength(4)
            expect(rests.reduce((sum, d) => sum + d.beats, 0)).toBe(4)
        })

        it('fills the remainder after a partial beat boundary', () => {
            // 2.5 beats filled: complete the current quarter (0.5 = an eighth) then one full quarter.
            const rests = new TimeSignature(4, 4).fillRests(2.5)
            expect(rests.reduce((sum, d) => sum + d.beats, 0)).toBeCloseTo(1.5)
            expect(rests.map((d) => d.type)).toEqual(['8', 'q'])
        })
    })
})
