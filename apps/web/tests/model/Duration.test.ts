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
        expect(d.effectiveBeats).toBeCloseTo((0.5 * 2) / 3)
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

    it('returns correct rest glyphs for every type', () => {
        expect(new Duration({ type: 'w' }).restGlyph).toBe('restWhole')
        expect(new Duration({ type: 'h' }).restGlyph).toBe('restHalf')
        expect(new Duration({ type: 'q' }).restGlyph).toBe('restQuarter')
        expect(new Duration({ type: '8' }).restGlyph).toBe('rest8th')
        expect(new Duration({ type: '16' }).restGlyph).toBe('rest16th')
    })

    it('returns correct notehead glyphs (whole, half, and filled for the rest)', () => {
        expect(new Duration({ type: 'w' }).noteheadGlyph).toBe('noteheadWhole')
        expect(new Duration({ type: 'h' }).noteheadGlyph).toBe('noteheadHalf')
        expect(new Duration({ type: 'q' }).noteheadGlyph).toBe('noteheadBlack')
        expect(new Duration({ type: '8' }).noteheadGlyph).toBe('noteheadBlack')
    })

    it('restLine sits a line higher for a whole rest than for shorter rests', () => {
        expect(new Duration({ type: 'w' }).restLine).toBe(4)
        expect(new Duration({ type: 'h' }).restLine).toBe(3)
        expect(new Duration({ type: 'q' }).restLine).toBe(3)
        expect(new Duration({ type: '8' }).restLine).toBe(3)
        expect(new Duration({ type: '16' }).restLine).toBe(3)
    })

    it('flagGlyph returns flag only for 8th/16th, undefined otherwise', () => {
        expect(new Duration({ type: 'q' }).flagGlyph('up')).toBeUndefined()
        expect(new Duration({ type: '8' }).flagGlyph('up')).toBe('flag8thUp')
        expect(new Duration({ type: '8' }).flagGlyph('down')).toBe('flag8thDown')
        expect(new Duration({ type: '16' }).flagGlyph('up')).toBe('flag16thUp')
        expect(new Duration({ type: '16' }).flagGlyph('down')).toBe('flag16thDown')
    })

    describe('tripletDivision', () => {
        it('divides a quarter into three eighths in a 3:2 ratio spanning the same time', () => {
            const divisions = new Duration({ type: 'q' }).tripletDivision()
            expect(divisions).toHaveLength(3)
            for (const d of divisions ?? []) {
                expect(d.type).toBe('8')
                expect(d.ratio).toEqual({ actualNotes: 3, normalNotes: 2 })
            }
            const total = (divisions ?? []).reduce((sum, d) => sum + d.effectiveBeats, 0)
            expect(total).toBeCloseTo(1)
        })

        it('carries dots over, preserving the total length', () => {
            const divisions = new Duration({ type: 'q', dots: 1 }).tripletDivision()
            expect(divisions?.every((d) => d.dots === 1)).toBe(true)
            const total = (divisions ?? []).reduce((sum, d) => sum + d.effectiveBeats, 0)
            expect(total).toBeCloseTo(1.5)
        })

        it('divides each supported value into three of the next-shorter value', () => {
            expect(new Duration({ type: 'w' }).tripletDivision()?.every((d) => d.type === 'h')).toBe(true)
            expect(new Duration({ type: 'h' }).tripletDivision()?.every((d) => d.type === 'q')).toBe(true)
            expect(new Duration({ type: 'q' }).tripletDivision()?.every((d) => d.type === '8')).toBe(true)
            expect(new Duration({ type: '8' }).tripletDivision()?.every((d) => d.type === '16')).toBe(true)
        })

        it('returns null for a 16th — no shorter value exists', () => {
            expect(new Duration({ type: '16' }).tripletDivision()).toBeNull()
        })
    })

    describe('fromBeats with a tuplet ratio', () => {
        it('decomposes ⅔ beat in 3:2 space into a quarter triplet', () => {
            const ds = Duration.fromBeats(2 / 3, { actualNotes: 3, normalNotes: 2 })
            expect(ds).toHaveLength(1)
            expect(ds[0].type).toBe('q')
            expect(ds[0].effectiveBeats).toBeCloseTo(2 / 3)
        })

        it('decomposes ⅙ beat in 3:2 space into a 16th triplet', () => {
            const ds = Duration.fromBeats(1 / 6, { actualNotes: 3, normalNotes: 2 })
            expect(ds).toHaveLength(1)
            expect(ds[0].type).toBe('16')
            expect(ds[0].effectiveBeats).toBeCloseTo(1 / 6)
        })
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

        it('stops when the remainder is too small to match any value', () => {
            // 0.1 beat is below the smallest value (16th = 0.25) but above the 0.001 loop guard,
            // so no value matches and decomposition halts with nothing produced.
            expect(Duration.fromBeats(0.1)).toEqual([])
        })

        it('drops a sub-16th remainder left after a larger match', () => {
            // 1.1 beats yields a quarter (1.0); the leftover 0.1 matches nothing and is dropped.
            const ds = Duration.fromBeats(1.1)
            expect(ds).toHaveLength(1)
            expect(ds[0].type).toBe('q')
        })
    })
})
