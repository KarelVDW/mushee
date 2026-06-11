import { describe, expect, it } from 'vitest'

import { Duration } from '@/model/Duration'
import { Measure } from '@/model/Measure'
import { Note } from '@/model/Note'
import { Pitch } from '@/model/Pitch'
import { Score } from '@/model/Score'
import { TimeSignature } from '@/model/TimeSignature'
import { BeamFinder } from '@/model/util/BeamFinder'

const eighth = (name = 'C', octave = 4) => new Note({ duration: new Duration({ type: '8' }), pitch: new Pitch({ name, octave }) })

const quarter = () => new Note({ duration: new Duration({ type: 'q' }) })

function freshMeasure() {
    return new Measure(new Score(), 'treble', new TimeSignature(4, 4))
}

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
})
