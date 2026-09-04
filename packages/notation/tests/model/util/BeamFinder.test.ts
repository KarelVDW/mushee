import { Duration } from '@mushee/notation/model/Duration'
import { Measure } from '@mushee/notation/model/Measure'
import { Note } from '@mushee/notation/model/Note'
import { Pitch } from '@mushee/notation/model/Pitch'
import { Score } from '@mushee/notation/model/Score'
import { TimeSignature } from '@mushee/notation/model/TimeSignature'
import { BeamFinder } from '@mushee/notation/model/util/BeamFinder'
import { describe, expect, it } from 'vitest'

const eighth = (name = 'C', octave = 4) => new Note({ duration: new Duration({ type: '8' }), pitch: new Pitch({ name, octave }) })

const quarter = () => new Note({ duration: new Duration({ type: 'q' }) })

function freshMeasure(beatAmount = 4, beatType = 4) {
    return new Measure(new Score(), 'treble', new TimeSignature(beatAmount, beatType))
}

const sixteenth = (name = 'C', octave = 4) => new Note({ duration: new Duration({ type: '16' }), pitch: new Pitch({ name, octave }) })

describe('BeamFinder', () => {
    it('groups consecutive eighth notes within a beat into a single beam group', () => {
        const m = freshMeasure()
        m.addNotes([eighth(), eighth()])
        const finder = new BeamFinder(m)
        expect(finder.groups).toHaveLength(1)
        expect(finder.groups[0].notes).toHaveLength(2)
    })

    it('does not beam fewer than 2 beamable notes', () => {
        const m = freshMeasure()
        m.addNotes([eighth(), quarter()])
        const finder = new BeamFinder(m)
        expect(finder.groups).toHaveLength(0)
    })

    it('breaks beams across beat boundaries', () => {
        const m = freshMeasure()
        // 4 eighth notes = 2 beats → 2 separate beam groups of 2
        m.addNotes([eighth(), eighth(), eighth(), eighth()])
        const finder = new BeamFinder(m)
        expect(finder.groups).toHaveLength(2)
    })

    it('flushes when a non-beamable note appears', () => {
        const m = freshMeasure()
        m.addNotes([eighth(), eighth(), quarter(), eighth(), eighth()])
        const finder = new BeamFinder(m)
        expect(finder.groups).toHaveLength(2)
    })

    it('rests interrupt beam groups', () => {
        const m = freshMeasure()
        m.addNotes([eighth(), new Note({ duration: new Duration({ type: '8' }) }), eighth()])
        const finder = new BeamFinder(m)
        // rest in middle prevents beaming all 3
        expect(finder.groups).toHaveLength(0)
    })

    it('each group lists its member notes in order', () => {
        const m = freshMeasure()
        const a = eighth()
        const b = eighth()
        m.addNotes([a, b])
        const finder = new BeamFinder(m)
        expect(finder.groups[0].notes).toEqual([a, b])
    })

    it('chooses stemDir based on average line', () => {
        const m = freshMeasure()
        // Both pitches at C4 (line 0) → stem up
        const finder = new BeamFinder(m.addNotes([eighth(), eighth()]))
        expect(finder.groups[0].stemDir).toBe('up')

        const m2 = freshMeasure()
        // Both at D5 → high → stem down
        const finder2 = new BeamFinder(m2.addNotes([eighth('D', 5), eighth('D', 5)]))
        expect(finder2.groups[0].stemDir).toBe('down')
    })

    describe('meter-aware grouping', () => {
        const sizes = (m: Measure) => new BeamFinder(m).groups.map((g) => g.notes.length)

        it('beams 6/8 eighths in threes (per dotted-quarter pulse), not in pairs', () => {
            const m = freshMeasure(6, 8)
            m.addNotes(Array.from({ length: 6 }, () => eighth()))
            expect(sizes(m)).toEqual([3, 3])
        })

        it('beams 6/8 sixteenths in sixes', () => {
            const m = freshMeasure(6, 8)
            m.addNotes(Array.from({ length: 12 }, () => sixteenth()))
            expect(sizes(m)).toEqual([6, 6])
        })

        it('beams 12/8 eighths in four groups of three', () => {
            const m = freshMeasure(12, 8)
            m.addNotes(Array.from({ length: 12 }, () => eighth()))
            expect(sizes(m)).toEqual([3, 3, 3, 3])
        })

        it('beams all three eighths of a 3/8 bar together', () => {
            const m = freshMeasure(3, 8)
            m.addNotes([eighth(), eighth(), eighth()])
            expect(sizes(m)).toEqual([3])
        })

        it('beams irregular eighth meters per bar (no stored grouping)', () => {
            const m = freshMeasure(7, 8)
            m.addNotes(Array.from({ length: 7 }, () => eighth()))
            expect(sizes(m)).toEqual([7])
        })

        it('beams 2/2 eighths four to a half-note beat', () => {
            const m = freshMeasure(2, 2)
            m.addNotes(Array.from({ length: 8 }, () => eighth()))
            expect(sizes(m)).toEqual([4, 4])
        })

        it('a rest inside a 6/8 group still splits it', () => {
            const m = freshMeasure(6, 8)
            m.addNotes([eighth(), new Note({ duration: new Duration({ type: '8' }) }), eighth(), eighth(), eighth(), eighth()])
            expect(sizes(m)).toEqual([3])
        })
    })
})
