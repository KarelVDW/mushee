import { makeScore, pitched } from '@test/helpers'
import { describe, expect, it } from 'vitest'

import { MAX_MEASURES_PER_ROW } from '@/components/notation/constants'
import { Duration } from '@/model/Duration'
import { Note } from '@/model/Note'
import { Pitch } from '@/model/Pitch'

const tieStartNote = () => new Note({ duration: new Duration({ type: 'q' }), pitch: new Pitch({ name: 'C', octave: 5 }), tie: 'start' })

describe('tie semantics (Score.tiePartner)', () => {
    it('pairs a tie-starting note with the next note in the same measure', () => {
        const score = makeScore(1)
        const m = score.measures[0]
        const first = m.firstNote
        if (!first) throw new Error('expected firstNote')
        const [start] = score.replace([first], [tieStartNote()])
        expect(score.tiePartner(start)).toBe(m.notes[1])
    })

    it('returns null for a note that does not tie forward', () => {
        const score = makeScore(1)
        const m = score.measures[0]
        const first = m.firstNote
        if (!first) throw new Error('expected firstNote')
        const [plain] = score.replace([first], [pitched('C', 5)])
        expect(score.tiePartner(plain)).toBeNull()
        // A tie-stop-only note does not tie forward either.
        const second = m.notes[1]
        const [stop] = score.replace([second], [new Note({ duration: new Duration({ type: 'q' }), pitch: new Pitch({ name: 'C', octave: 5 }), tie: 'stop' })])
        expect(score.tiePartner(stop)).toBeNull()
    })

    it('a start-stop note ties forward too', () => {
        const score = makeScore(1)
        const m = score.measures[0]
        const first = m.firstNote
        if (!first) throw new Error('expected firstNote')
        const [mid] = score.replace([first], [new Note({ duration: new Duration({ type: 'q' }), pitch: new Pitch({ name: 'C', octave: 5 }), tie: 'start-stop' })])
        expect(score.tiePartner(mid)).toBe(m.notes[1])
    })

    it('pairs across a measure boundary', () => {
        const score = makeScore(2)
        const [m0, m1] = score.measures
        const last = m0.lastNote
        if (!last) throw new Error('expected last note')
        const [start] = score.replace([last], [tieStartNote()])
        expect(score.tiePartner(start)).toBe(m1.firstNote)
    })

    it('pairs across a row boundary (the endpoints sit on different rows)', () => {
        const score = makeScore(MAX_MEASURES_PER_ROW + 1)
        const rowEndMeasure = score.measures[MAX_MEASURES_PER_ROW - 1]
        const nextRowMeasure = score.measures[MAX_MEASURES_PER_ROW]
        const lastNote = rowEndMeasure.lastNote
        if (!lastNote) throw new Error('expected last note of row-ending measure')
        const [start] = score.replace([lastNote], [tieStartNote()])
        // Sanity: the endpoints really are on different rows.
        expect(score.layout.rowFor(rowEndMeasure)).not.toBe(score.layout.rowFor(nextRowMeasure))
        expect(score.tiePartner(start)).toBe(nextRowMeasure.firstNote)
    })

    it('a tie-forward note at the very end of the score has no partner', () => {
        const score = makeScore(1)
        const m = score.measures[0]
        const lastNote = m.lastNote
        if (!lastNote) throw new Error('expected last note')
        const [start] = score.replace([lastNote], [tieStartNote()])
        expect(score.tiePartner(start)).toBeNull()
    })

    it('removing the last measure breaks a tie into it', () => {
        const score = makeScore(2)
        const m0 = score.measures[0]
        const last = m0.lastNote
        if (!last) throw new Error('expected last note')
        const [start] = score.replace([last], [tieStartNote()])
        expect(score.tiePartner(start)).not.toBeNull()
        score.removeLastMeasure()
        // The sustained-into note is gone; the pairing recomputes to null.
        expect(score.tiePartner(start)).toBeNull()
    })

    it('replacing a tie-starting note clears the pairing', () => {
        const score = makeScore(1)
        const m = score.measures[0]
        const first = m.firstNote
        if (!first) throw new Error('expected firstNote')
        const [start] = score.replace([first], [tieStartNote()])
        expect(score.tiePartner(start)).toBe(m.notes[1])
        const [plain] = score.replace([start], [pitched('D', 5)])
        expect(score.tiePartner(plain)).toBeNull()
    })

    it('pairings are stable between reads without a mutation', () => {
        const score = makeScore(2)
        const last = score.measures[0].lastNote
        if (!last) throw new Error('expected last note')
        const [start] = score.replace([last], [tieStartNote()])
        const partner = score.tiePartner(start)
        expect(score.tiePartner(start)).toBe(partner) // derived map cached per version
    })
})
