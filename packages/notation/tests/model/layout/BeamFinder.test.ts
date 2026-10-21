import { Duration } from '@mushee/notation/model/Duration'
import { BeamFinder } from '@mushee/notation/model/layout/BeamFinder'
import type { Measure } from '@mushee/notation/model/Measure'
import { Note } from '@mushee/notation/model/Note'
import { measure, pitched, rest } from '@mushee/notation/testing'
import { describe, expect, it } from 'vitest'

describe('BeamFinder', () => {
    it('groups consecutive eighth notes within a beat into a single beam group', () => {
        const m = measure()
        m.addNotes([pitched('C', 4, '8'), pitched('C', 4, '8')])
        const finder = new BeamFinder(m)
        expect(finder.groups).toHaveLength(1)
        expect(finder.groups[0].notes).toHaveLength(2)
    })

    it('does not beam fewer than 2 beamable notes', () => {
        const m = measure()
        m.addNotes([pitched('C', 4, '8'), rest('q')])
        const finder = new BeamFinder(m)
        expect(finder.groups).toHaveLength(0)
    })

    it('breaks beams across beat boundaries', () => {
        const m = measure()
        // 4 eighth notes = 2 beats → 2 separate beam groups of 2
        m.addNotes([pitched('C', 4, '8'), pitched('C', 4, '8'), pitched('C', 4, '8'), pitched('C', 4, '8')])
        const finder = new BeamFinder(m)
        expect(finder.groups).toHaveLength(2)
    })

    it('flushes when a non-beamable note appears', () => {
        const m = measure()
        m.addNotes([pitched('C', 4, '8'), pitched('C', 4, '8'), rest('q'), pitched('C', 4, '8'), pitched('C', 4, '8')])
        const finder = new BeamFinder(m)
        expect(finder.groups).toHaveLength(2)
    })

    it('rests interrupt beam groups', () => {
        const m = measure()
        m.addNotes([pitched('C', 4, '8'), new Note({ duration: new Duration({ type: '8' }) }), pitched('C', 4, '8')])
        const finder = new BeamFinder(m)
        // rest in middle prevents beaming all 3
        expect(finder.groups).toHaveLength(0)
    })

    it('each group lists its member notes in order', () => {
        const m = measure()
        const a = pitched('C', 4, '8')
        const b = pitched('C', 4, '8')
        m.addNotes([a, b])
        const finder = new BeamFinder(m)
        expect(finder.groups[0].notes).toEqual([a, b])
    })

    it('chooses stemDir based on average line', () => {
        const m = measure()
        // Both pitches at C4 (line 0) → stem up
        const finder = new BeamFinder(m.addNotes([pitched('C', 4, '8'), pitched('C', 4, '8')]))
        expect(finder.groups[0].stemDir).toBe('up')

        const m2 = measure()
        // Both at D5 → high → stem down
        const finder2 = new BeamFinder(m2.addNotes([pitched('D', 5, '8'), pitched('D', 5, '8')]))
        expect(finder2.groups[0].stemDir).toBe('down')
    })

    describe('meter-aware grouping', () => {
        const sizes = (m: Measure) => new BeamFinder(m).groups.map((g) => g.notes.length)

        it('beams 6/8 eighths in threes (per dotted-quarter pulse), not in pairs', () => {
            const m = measure(6, 8)
            m.addNotes(Array.from({ length: 6 }, () => pitched('C', 4, '8')))
            expect(sizes(m)).toEqual([3, 3])
        })

        it('beams 6/8 sixteenths in sixes', () => {
            const m = measure(6, 8)
            m.addNotes(Array.from({ length: 12 }, () => pitched('C', 4, '16')))
            expect(sizes(m)).toEqual([6, 6])
        })

        it('beams 12/8 eighths in four groups of three', () => {
            const m = measure(12, 8)
            m.addNotes(Array.from({ length: 12 }, () => pitched('C', 4, '8')))
            expect(sizes(m)).toEqual([3, 3, 3, 3])
        })

        it('beams all three eighths of a 3/8 bar together', () => {
            const m = measure(3, 8)
            m.addNotes([pitched('C', 4, '8'), pitched('C', 4, '8'), pitched('C', 4, '8')])
            expect(sizes(m)).toEqual([3])
        })

        it('beams irregular eighth meters per bar (no stored grouping)', () => {
            const m = measure(7, 8)
            m.addNotes(Array.from({ length: 7 }, () => pitched('C', 4, '8')))
            expect(sizes(m)).toEqual([7])
        })

        it('beams 2/2 eighths four to a half-note beat', () => {
            const m = measure(2, 2)
            m.addNotes(Array.from({ length: 8 }, () => pitched('C', 4, '8')))
            expect(sizes(m)).toEqual([4, 4])
        })

        it('a rest inside a 6/8 group still splits it', () => {
            const m = measure(6, 8)
            m.addNotes([
                pitched('C', 4, '8'),
                new Note({ duration: new Duration({ type: '8' }) }),
                pitched('C', 4, '8'),
                pitched('C', 4, '8'),
                pitched('C', 4, '8'),
                pitched('C', 4, '8'),
            ])
            expect(sizes(m)).toEqual([3])
        })
    })
})
