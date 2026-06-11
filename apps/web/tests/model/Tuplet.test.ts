import { describe, expect, it } from 'vitest'

import { Duration } from '@/model/Duration'
import { Note } from '@/model/Note'
import { Pitch } from '@/model/Pitch'
import { Score } from '@/model/Score'

const tripletEighth = () =>
    new Note({
        duration: new Duration({ type: '8', ratio: { actualNotes: 3, normalNotes: 2 } }),
        pitch: new Pitch({ name: 'C', octave: 4 }),
    })

describe('Tuplet', () => {
    function setup() {
        const score = new Score()
        const m = score.addMeasure()
        const a = tripletEighth()
        const b = tripletEighth()
        const c = tripletEighth()
        m.addNotes([a, b, c])
        // TupletFinder derives the group lazily from the measure's notes.
        const tuplet = m.tuplets[0]
        return { score, measure: m, a, b, c, tuplet }
    }

    it('exposes constructor inputs', () => {
        const { measure, a, b, c, tuplet } = setup()
        expect(tuplet).toBeDefined()
        expect(tuplet.measure).toBe(measure)
        expect(tuplet.notes).toEqual([a, b, c])
    })

    it('firstNote / lastNote', () => {
        const { a, c, tuplet } = setup()
        expect(tuplet.firstNote).toBe(a)
        expect(tuplet.lastNote).toBe(c)
    })

    it('getIndex returns position or null', () => {
        const { a, c, tuplet } = setup()
        expect(tuplet.getIndex(a)).toBe(0)
        expect(tuplet.getIndex(c)).toBe(2)
        expect(tuplet.getIndex(tripletEighth())).toBeNull()
    })

    it('layout delegates into the score layout and is stable without mutation', () => {
        const { tuplet } = setup()
        expect(tuplet.layout).toBe(tuplet.layout)
    })

    it('a measure mutation produces a fresh tuplet group with a fresh layout', () => {
        const { measure, tuplet } = setup()
        const layoutBefore = tuplet.layout
        measure.addNotes([new Note({ duration: new Duration({ type: 'q' }) })])
        const after = measure.tuplets[0]
        expect(after).not.toBe(tuplet) // groups are re-derived per measure version
        expect(after.layout).not.toBe(layoutBefore)
    })
})
