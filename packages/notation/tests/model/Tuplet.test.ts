import { Duration } from '@mushee/notation/model/Duration'
import { Note } from '@mushee/notation/model/Note'
import { Score } from '@mushee/notation/model/Score'
import { triplet } from '@mushee/notation/testing'
import { describe, expect, it } from 'vitest'

describe('Tuplet', () => {
    function setup() {
        const score = new Score()
        const m = score.addMeasure()
        const a = triplet()
        const b = triplet()
        const c = triplet()
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

    it("its measure's layout keeps one tuplet layout without mutation", () => {
        const { measure, tuplet } = setup()
        expect(measure.layout.tupletLayoutFor(tuplet)).toBe(measure.layout.tupletLayoutFor(tuplet))
    })

    it('a measure mutation produces a fresh tuplet group with a fresh layout', () => {
        const { measure, tuplet } = setup()
        const layoutBefore = measure.layout.tupletLayoutFor(tuplet)
        measure.addNotes([new Note({ duration: new Duration({ type: 'q' }) })])
        const after = measure.tuplets[0]
        expect(after).not.toBe(tuplet) // groups are re-derived per measure version
        expect(measure.layout.tupletLayoutFor(after)).not.toBe(layoutBefore)
    })
})
