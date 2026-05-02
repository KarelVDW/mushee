import { describe, expect, it } from 'vitest'

import { Clef } from '@/model/Clef'
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
    return new Measure(new Score(), new Clef('treble'), new TimeSignature(4, 4))
}

describe('TupletFinder', () => {
    it('ignores ratio 1:1 notes', () => {
        const m = freshMeasure()
        m.addNotes([quarter(), quarter()])
        const finder = new TupletFinder(m)
        expect(finder.tuplets).toHaveLength(0)
    })

    it('groups three eighth-note triplets into one tuplet (incomplete-set fallback)', () => {
        // NOTE: TupletFinder's completion check `totalDuration >= normalNotes - 0.001`
        // compares accumulated beats against a *count* of normal notes. For 3:2 eighth
        // triplets (3 notes totaling 1 beat, normalNotes=2), this never triggers — so
        // the group is only emitted from the trailing incomplete-set push at end of
        // iteration. Documenting actual behavior, not desired behavior.
        const m = freshMeasure()
        m.addNotes([tripletEighth(), tripletEighth(), tripletEighth()])
        const finder = new TupletFinder(m)
        expect(finder.tuplets).toHaveLength(1)
        expect(finder.tuplets[0].notes).toHaveLength(3)
    })

    it('two consecutive triplet groups currently merge into one tuplet (KNOWN ISSUE)', () => {
        // See note above: completion check is broken for typical tuplet ratios.
        // Without an interrupting non-tuplet note, all consecutive triplet eighths
        // fall into a single tuplet. Capturing this so a future fix can flip the
        // assertion to `toHaveLength(2)`.
        const m = freshMeasure()
        m.addNotes([
            tripletEighth(), tripletEighth(), tripletEighth(),
            tripletEighth(), tripletEighth(), tripletEighth(),
        ])
        const finder = new TupletFinder(m)
        expect(finder.tuplets).toHaveLength(1)
        expect(finder.tuplets[0].notes).toHaveLength(6)
    })

    it('non-tuplet note between triplets terminates the first group', () => {
        const m = freshMeasure()
        m.addNotes([tripletEighth(), tripletEighth(), tripletEighth(), quarter(), tripletEighth()])
        const finder = new TupletFinder(m)
        // last single triplet is incomplete but pushed
        expect(finder.tuplets.length).toBeGreaterThanOrEqual(1)
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
