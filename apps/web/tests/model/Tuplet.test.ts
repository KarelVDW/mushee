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
        // TupletFinder runs in recompute()
        const tuplet = m.tuplets[0]
        return { measure: m, a, b, c, tuplet }
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

    it('hasNote', () => {
        const { a, tuplet } = setup()
        expect(tuplet.hasNote(a)).toBe(true)
        expect(tuplet.hasNote(tripletEighth())).toBe(false)
    })

    it('invalidateLayout clears cached layout', () => {
        const { tuplet } = setup()
        const l1 = tuplet.layout
        tuplet.invalidateLayout()
        expect(tuplet.layout).not.toBe(l1)
    })
})
