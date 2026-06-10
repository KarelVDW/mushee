import { describe, expect, it } from 'vitest'

import { Duration } from '@/model/Duration'
import { Measure } from '@/model/Measure'
import { Note } from '@/model/Note'
import { Pitch } from '@/model/Pitch'
import { Score } from '@/model/Score'
import { TimeSignature } from '@/model/TimeSignature'
import { TupletFinder } from '@/model/util/TupletFinder'

const tripletEighth = () =>
    new Note({
        duration: new Duration({ type: '8', ratio: { actualNotes: 3, normalNotes: 2 } }),
        pitch: new Pitch({ name: 'C', octave: 4 }),
    })

const quarter = () => new Note({ duration: new Duration({ type: 'q' }) })

function freshMeasure() {
    return new Measure(new Score(), 'treble', new TimeSignature(4, 4))
}

describe('TupletFinder', () => {
    it('ignores ratio 1:1 notes', () => {
        const m = freshMeasure()
        m.addNotes([quarter(), quarter()])
        const finder = new TupletFinder(m)
        expect(finder.tuplets).toHaveLength(0)
    })

    it('groups three eighth-note triplets into one tuplet', () => {
        const m = freshMeasure()
        m.addNotes([tripletEighth(), tripletEighth(), tripletEighth()])
        const finder = new TupletFinder(m)
        expect(finder.tuplets).toHaveLength(1)
        expect(finder.tuplets[0].notes).toHaveLength(3)
    })

    it('splits two consecutive triplet groups into separate tuplets', () => {
        // A group is complete when it spans normalNotes of its base value (two eighths
        // = 1 beat for a 3:2 eighth triplet), so back-to-back triplets don't merge.
        const m = freshMeasure()
        m.addNotes([tripletEighth(), tripletEighth(), tripletEighth(), tripletEighth(), tripletEighth(), tripletEighth()])
        const finder = new TupletFinder(m)
        expect(finder.tuplets).toHaveLength(2)
        expect(finder.tuplets[0].notes).toHaveLength(3)
        expect(finder.tuplets[1].notes).toHaveLength(3)
    })

    it('keeps a triplet with a subdivided first slot as one group', () => {
        const sixteenth = () => new Note({ duration: new Duration({ type: '16', ratio: { actualNotes: 3, normalNotes: 2 } }) })
        const m = freshMeasure()
        m.addNotes([sixteenth(), sixteenth(), tripletEighth(), tripletEighth()])
        const finder = new TupletFinder(m)
        expect(finder.tuplets).toHaveLength(1)
        expect(finder.tuplets[0].notes).toHaveLength(4)
    })

    it('keeps a triplet with merged slots (eighth + quarter) as one group', () => {
        const quarterTriplet = () =>
            new Note({ duration: new Duration({ type: 'q', ratio: { actualNotes: 3, normalNotes: 2 } }), pitch: new Pitch({ name: 'C', octave: 4 }) })
        const m = freshMeasure()
        m.addNotes([tripletEighth(), quarterTriplet()])
        const finder = new TupletFinder(m)
        expect(finder.tuplets).toHaveLength(1)
        expect(finder.tuplets[0].notes).toHaveLength(2)
    })

    it('non-tuplet note between triplets terminates the first group', () => {
        const m = freshMeasure()
        m.addNotes([tripletEighth(), tripletEighth(), tripletEighth(), quarter(), tripletEighth()])
        const finder = new TupletFinder(m)
        // last single triplet is incomplete but pushed
        expect(finder.tuplets.length).toBeGreaterThanOrEqual(1)
    })

    it('flushes an incomplete tuplet group when a plain (1:1) note follows', () => {
        // Two triplet eighths sound 0.667 beats — short of the 1.0-beat span — so the group is still
        // open when the quarter arrives. The 1:1 branch must push that partial group before continuing.
        const m = freshMeasure()
        m.addNotes([tripletEighth(), tripletEighth(), quarter()])
        const finder = new TupletFinder(m)
        expect(finder.tuplets).toHaveLength(1)
        expect(finder.tuplets[0].notes).toHaveLength(2)
    })

    it('flushes an incomplete group when the ratio changes mid-stream', () => {
        const quintupletSixteenth = () =>
            new Note({ duration: new Duration({ type: '16', ratio: { actualNotes: 5, normalNotes: 4 } }), pitch: new Pitch({ name: 'C', octave: 4 }) })
        // Open 3:2 group (incomplete after two eighths), then a 5:4 note: the ratio change closes the
        // first group and starts a fresh one.
        const m = freshMeasure()
        m.addNotes([tripletEighth(), tripletEighth(), quintupletSixteenth()])
        const finder = new TupletFinder(m)
        expect(finder.tuplets).toHaveLength(2)
        expect(finder.tuplets[0].notes).toHaveLength(2)
        expect(finder.tuplets[1].notes).toHaveLength(1)
    })

    it('tupletByNote maps each tuplet note back to its tuplet', () => {
        const m = freshMeasure()
        const a = tripletEighth()
        const b = tripletEighth()
        const c = tripletEighth()
        m.addNotes([a, b, c])
        const finder = new TupletFinder(m)
        expect(finder.tupletByNote.get(a)).toBe(finder.tuplets[0])
        expect(finder.tupletByNote.get(b)).toBe(finder.tuplets[0])
        expect(finder.tupletByNote.get(c)).toBe(finder.tuplets[0])
    })
})
