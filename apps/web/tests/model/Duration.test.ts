import { describe, expect, it } from 'vitest'

import { Duration } from '@/model/Duration'

describe('Duration', () => {
    it('defaults to a quarter note with no dots and 1:1 ratio', () => {
        const d = new Duration()
        expect(d.type).toBe('q')
        expect(d.dots).toBe(0)
        expect(d.beats).toBe(1)
        expect(d.effectiveBeats).toBe(1)
    })

    it('baseBeats matches duration type', () => {
        expect(new Duration({ type: 'w' }).baseBeats).toBe(4)
        expect(new Duration({ type: 'h' }).baseBeats).toBe(2)
        expect(new Duration({ type: 'q' }).baseBeats).toBe(1)
        expect(new Duration({ type: '8' }).baseBeats).toBe(0.5)
        expect(new Duration({ type: '16' }).baseBeats).toBe(0.25)
    })

    it('applies dot multiplier (1 dot = 1.5×, 2 dots = 1.75×)', () => {
        expect(new Duration({ type: 'q', dots: 1 }).beats).toBeCloseTo(1.5)
        expect(new Duration({ type: 'q', dots: 2 }).beats).toBeCloseTo(1.75)
        expect(new Duration({ type: 'h', dots: 1 }).beats).toBeCloseTo(3)
    })

    it('effectiveBeats applies tuplet ratio', () => {
        // triplet eighth: actual 3 in space of 2 → 0.5 * (2/3)
        const d = new Duration({ type: '8', ratio: { actualNotes: 3, normalNotes: 2 } })
        expect(d.effectiveBeats).toBeCloseTo(0.5 * 2 / 3)
    })

    it('isBeamable for 8th and 16th only', () => {
        expect(new Duration({ type: '8' }).isBeamable).toBe(true)
        expect(new Duration({ type: '16' }).isBeamable).toBe(true)
        expect(new Duration({ type: 'q' }).isBeamable).toBe(false)
        expect(new Duration({ type: 'h' }).isBeamable).toBe(false)
    })

    it('hasSecondaryBeam only for 16th', () => {
        expect(new Duration({ type: '16' }).hasSecondaryBeam).toBe(true)
        expect(new Duration({ type: '8' }).hasSecondaryBeam).toBe(false)
    })

    it('returns correct rest and notehead glyphs', () => {
        expect(new Duration({ type: 'w' }).restGlyph).toBe('restWhole')
        expect(new Duration({ type: '16' }).restGlyph).toBe('rest16th')
        expect(new Duration({ type: 'w' }).noteheadGlyph).toBe('noteheadWhole')
        expect(new Duration({ type: 'q' }).noteheadGlyph).toBe('noteheadBlack')
    })

    it('flagGlyph returns flag only for 8th/16th, undefined otherwise', () => {
        expect(new Duration({ type: 'q' }).flagGlyph('up')).toBeUndefined()
        expect(new Duration({ type: '8' }).flagGlyph('up')).toBe('flag8thUp')
        expect(new Duration({ type: '8' }).flagGlyph('down')).toBe('flag8thDown')
        expect(new Duration({ type: '16' }).flagGlyph('up')).toBe('flag16thUp')
    })

    describe('fromBeats (greedy decomposition)', () => {
        it('returns empty array for 0 beats', () => {
            expect(Duration.fromBeats(0)).toEqual([])
        })

        it('decomposes 4 beats to a whole note', () => {
            const ds = Duration.fromBeats(4)
            expect(ds).toHaveLength(1)
            expect(ds[0].type).toBe('w')
        })

        it('decomposes 1.5 beats to a dotted quarter', () => {
            const ds = Duration.fromBeats(1.5)
            expect(ds).toHaveLength(1)
            expect(ds[0].type).toBe('q')
            expect(ds[0].dots).toBe(1)
        })

        it('decomposes 5.5 beats to whole + dotted quarter', () => {
            const ds = Duration.fromBeats(5.5)
            const totalBeats = ds.reduce((sum, d) => sum + d.beats, 0)
            expect(totalBeats).toBeCloseTo(5.5)
        })

        it('decomposes 0.25 to a 16th', () => {
            const ds = Duration.fromBeats(0.25)
            expect(ds).toHaveLength(1)
            expect(ds[0].type).toBe('16')
        })
    })
})
