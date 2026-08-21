import { Duration } from '@mushee/notation/model/Duration'
import { Note } from '@mushee/notation/model/Note'
import { Pitch } from '@mushee/notation/model/Pitch'
import type { Score } from '@mushee/notation/model/Score'
import { AccidentalMinimizer } from '@mushee/notation/model/util/AccidentalMinimizer'
import { makeScore } from '@mushee/notation/testing'
import { describe, expect, it } from 'vitest'

/** A quarter note (or rest without `pitch`). */
const q = (pitch?: Pitch, tie?: 'start' | 'stop') => new Note({ duration: new Duration({ type: 'q' }), pitch, tie })

const p = (name: string, octave: number, alter = 0) => new Pitch({ name, octave, alter })

/** Replace a 4/4 measure's four rests with the given four notes. */
function fill(score: Score, measureIndex: number, notes: Note[]) {
    const measure = score.measures[measureIndex]
    score.replace(measure.notes, notes)
    return measure
}

/** Run the minimizer over every note of the score, all of them respellable. */
function minimize(score: Score) {
    const walk = score.measures.flatMap((m) => m.notes)
    return new AccidentalMinimizer(walk, new Set(walk), (note) => note.keySignature.fifths)
}

const spelled = (result: AccidentalMinimizer, note: Note) => {
    const pitch = result.respelled.get(note) ?? note.pitch
    return pitch ? `${pitch.name}${pitch.alter > 0 ? '#'.repeat(pitch.alter) : 'b'.repeat(-pitch.alter)}${pitch.octave}` : null
}

describe('AccidentalMinimizer', () => {
    it('key-implied alterations are free; contradicting the key costs one', () => {
        const score = makeScore(1)
        const m = fill(score, 0, [q(p('F', 4, 1)), q(p('F', 4)), q(p('G', 4)), q(p('G', 4))])
        m.setKeySignature(0, 1) // G major: F♯ in key
        const result = minimize(score)
        // F♯ free, F♮ draws a natural, both Gs free.
        expect(result.drawnCount).toBe(1)
        expect(result.respelled.size).toBe(0)
    })

    it('an accidental carries for the rest of the bar on its (name, octave) and expires at the bar line', () => {
        const score = makeScore(2)
        fill(score, 0, [q(p('G', 4, 1)), q(p('G', 4, 1)), q(p('G', 5, 1)), q()])
        fill(score, 1, [q(p('G', 4, 1)), q(), q(), q()])
        const result = minimize(score)
        // Bar 1: first G♯4 draws, second is carried, G♯5 is another octave slot. Bar 2: fresh.
        expect(result.drawnCount).toBe(3)
    })

    it('a mid-measure key change cancels carried accidentals', () => {
        const score = makeScore(1)
        const m = fill(score, 0, [q(p('F', 4, 1)), q(p('F', 4, 1)), q(p('F', 4, 1)), q()])
        m.addKeySignature(2, 1) // beat 2: G major (F♯ becomes key-implied)
        const result = minimize(score)
        // Beat 0 draws the sharp, beat 1 carries it, beat 2 is key-implied under the new key.
        expect(result.drawnCount).toBe(1)
    })

    it('non-target notes keep their spelling but still occupy the bar', () => {
        const score = makeScore(1)
        const m = fill(score, 0, [q(p('G', 4, 1)), q(p('A', 4, -1)), q(), q()])
        const [fixed, target] = m.notes
        const result = new AccidentalMinimizer(m.notes, new Set([target]), () => 0)
        // A♭4 sounds like the carried G♯4: reusing the G slot is free, staying A♭ would draw.
        expect(result.respelled.size).toBe(1)
        expect(spelled(result, target)).toBe('G#4')
        expect(result.respelled.has(fixed)).toBe(false)
        expect(result.drawnCount).toBe(1) // only the fixed G♯4 draws
    })

    it('prefers flats in flat keys and sharps elsewhere; the key-implied spelling beats both', () => {
        const score = makeScore(2)
        fill(score, 0, [q(p('A', 4, 1)), q(p('C', 4, 1)), q(), q()])
        const flat = fill(score, 1, [q(p('C', 5, 1)), q(), q(), q()])
        flat.setKeySignature(0, -4) // A♭ major: D♭ is in key
        const result = minimize(score)
        expect(spelled(result, score.measures[0].notes[0])).toBe('A#4') // C major: sharp side kept
        expect(spelled(result, score.measures[1].notes[0])).toBe('Db5') // in-key flat spelling is free
        expect(result.drawnCount).toBe(2) // bar 1 draws both sharps; bar 2 draws nothing
    })

    it('keeps the current spelling when no candidate is cheaper', () => {
        const score = makeScore(1)
        fill(score, 0, [q(p('A', 4, -1)), q(), q(), q()])
        const result = minimize(score)
        // A♭4 and G♯4 both cost one in C major; the note's own spelling wins the tie.
        expect(result.respelled.size).toBe(0)
        expect(result.drawnCount).toBe(1)
    })

    it('prefers the plainer alteration among equally-priced strangers', () => {
        const score = makeScore(1)
        const m = fill(score, 0, [q(p('G', 4, -2)), q(), q(), q()])
        m.setKeySignature(0, 5) // B major: G𝄫 respells to E♯ or F♮, both cost one — F♮ (alter 0) is plainer
        const result = minimize(score)
        expect(spelled(result, m.notes[0])).toBe('F4')
        expect(result.drawnCount).toBe(1)
    })

    it('respells across the octave label when the plain name lives there', () => {
        const score = makeScore(1)
        fill(score, 0, [q(p('B', 3, 1)), q(), q(), q()])
        const result = minimize(score)
        expect(spelled(result, score.measures[0].notes[0])).toBe('C4')
        expect(result.drawnCount).toBe(0)
    })

    it('a tied continuation is forced onto its predecessor’s chosen spelling', () => {
        const score = makeScore(1)
        const m = fill(score, 0, [q(p('A', 4, 1), 'start'), q(p('A', 4, 1)), q(), q()])
        m.setKeySignature(0, -1) // F major: B♭ is in key, so A♯ respells to B♭
        const result = minimize(score)
        expect(spelled(result, m.notes[0])).toBe('Bb4')
        expect(spelled(result, m.notes[1])).toBe('Bb4')
        expect(result.drawnCount).toBe(0)
    })

    it('a tie from outside the walked range forces the predecessor’s written spelling', () => {
        const score = makeScore(2)
        fill(score, 0, [q(), q(), q(), q(p('A', 4, 1), 'start')])
        fill(score, 1, [q(p('A', 4, 1)), q(), q(), q()])
        const second = score.measures[1]
        // Walk only bar 2 (a selection respell): the predecessor was never analyzed, so its
        // written A♯ wins even though B♭ would be free to choose otherwise.
        const result = new AccidentalMinimizer(second.notes, new Set(second.notes), () => -1)
        expect(result.respelled.size).toBe(0)
        expect(result.drawnCount).toBe(1)
    })

    it('a tie whose notes do not sound alike does not force the spelling', () => {
        const score = makeScore(1)
        const m = fill(score, 0, [q(p('C', 4), 'start'), q(p('D', 4)), q(), q()])
        const result = minimize(score)
        expect(result.respelled.size).toBe(0)
        expect(result.drawnCount).toBe(0)
    })

    it('an imported tie-stop after a rest falls back to free spelling choice', () => {
        const score = makeScore(1)
        const m = fill(score, 0, [q(), q(p('B', 3, 1), 'stop'), q(), q()])
        const result = minimize(score)
        expect(spelled(result, m.notes[1])).toBe('C4')
    })

    it('rests are skipped entirely', () => {
        const score = makeScore(1)
        const result = minimize(score) // four rests
        expect(result.drawnCount).toBe(0)
        expect(result.respelled.size).toBe(0)
    })

    describe('compareRanks', () => {
        it('orders lexicographically and treats equal vectors as equal', () => {
            expect(AccidentalMinimizer.compareRanks([0, 1], [1, 0])).toBeLessThan(0)
            expect(AccidentalMinimizer.compareRanks([1, 2], [1, 1])).toBeGreaterThan(0)
            expect(AccidentalMinimizer.compareRanks([1, 2, 3], [1, 2, 3])).toBe(0)
        })
    })
})
