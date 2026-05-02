import { describe, expect, it } from 'vitest'

import { Duration } from '@/model/Duration'
import { Note } from '@/model/Note'
import { Pitch } from '@/model/Pitch'
import { Score } from '@/model/Score'

const eighth = (name = 'C', octave = 4) =>
    new Note({ duration: new Duration({ type: '8' }), pitch: new Pitch({ name, octave }) })

describe('Beam', () => {
    function setup() {
        const score = new Score()
        const m = score.addMeasure()
        const a = eighth()
        const b = eighth()
        m.addNotes([a, b])
        // BeamFinder runs in recompute() and produces a beam for these two eighths
        const beam = m.beams[0]
        return { measure: m, a, b, beam }
    }

    it('exposes constructor inputs', () => {
        const { measure, a, b, beam } = setup()
        expect(beam).toBeDefined()
        expect(beam.measure).toBe(measure)
        expect(beam.notes).toEqual([a, b])
    })

    it('firstNote / lastNote', () => {
        const { a, b, beam } = setup()
        expect(beam.firstNote).toBe(a)
        expect(beam.lastNote).toBe(b)
    })

    it('getIndex returns position or null', () => {
        const { a, b, beam } = setup()
        expect(beam.getIndex(a)).toBe(0)
        expect(beam.getIndex(b)).toBe(1)
        expect(beam.getIndex(eighth())).toBeNull()
    })

    it('hasNote tracks membership', () => {
        const { a, beam } = setup()
        expect(beam.hasNote(a)).toBe(true)
        expect(beam.hasNote(eighth())).toBe(false)
    })

    it('invalidateLayout clears cached BeamLayout', () => {
        const { beam } = setup()
        const l1 = beam.layout
        beam.invalidateLayout()
        expect(beam.layout).not.toBe(l1)
    })
})
