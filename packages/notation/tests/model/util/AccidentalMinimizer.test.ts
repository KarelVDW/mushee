import { Duration } from '@mushee/notation/model/Duration'
import { Instrument } from '@mushee/notation/model/Instrument'
import { Note } from '@mushee/notation/model/Note'
import { Pitch } from '@mushee/notation/model/Pitch'
import type { Score } from '@mushee/notation/model/Score'
import { AccidentalMinimizer } from '@mushee/notation/model/util/AccidentalMinimizer'
import { makeScore } from '@mushee/notation/testing'
import { describe, expect, it } from 'vitest'

import { describeScore, soundingEvents } from './scoreObservations'

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
        fill(score, 0, [q(p('C', 4), 'start'), q(p('D', 4)), q(), q()])
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

    it('ranking on sounding pitch ignores the current spelling, so an audition cannot depend on what the pass rewrites', () => {
        // C major: E♭4 then E4. Ranking on spelling keeps the written E♭ (ties break toward the
        // current spelling), and the E♮ then needs a natural to cancel it: two accidentals. Ranking
        // on sound spells the first note D♯ (sharp side of the pair) and the E is free: one — and
        // the count is the same whichever way the notes arrive spelled.
        const asFlat = makeScore(1)
        fill(asFlat, 0, [q(p('E', 4, -1)), q(p('E', 4)), q(), q()])
        const asSharp = makeScore(1)
        fill(asSharp, 0, [q(p('D', 4, 1)), q(p('E', 4)), q(), q()])
        const audition = (score: Score) => {
            const walk = score.measures.flatMap((m) => m.notes)
            return new AccidentalMinimizer(walk, new Set(walk), () => 0, 'sounding')
        }
        expect(minimize(asFlat).drawnCount).toBe(2)
        expect(audition(asFlat).drawnCount).toBe(1)
        expect(audition(asSharp).drawnCount).toBe(1)
        expect(spelled(audition(asFlat), asFlat.measures[0].notes[0])).toBe('D#4')
    })

    it('ranking on sounding pitch frees a tie continuation from a predecessor outside the walk', () => {
        const score = makeScore(2)
        fill(score, 0, [q(), q(), q(), q(p('A', 4, 1), 'start')])
        fill(score, 1, [q(p('A', 4, 1)), q(), q(), q()])
        const second = score.measures[1]
        // F major audition over bar 2 alone: the written A♯ of the (unwalked) predecessor must not
        // decide bar 2's key, so the continuation is free to be the key's B♭.
        const result = new AccidentalMinimizer(second.notes, new Set(second.notes), () => -1, 'sounding')
        expect(result.drawnCount).toBe(0)
        expect(spelled(result, second.notes[0])).toBe('Bb4')
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

/** The production entry point, hand-built cases: the property the generated-score invariant pins, localised. */
describe('Score.minimizeAccidentals is idempotent', () => {
    /** Run the whole-score pass twice; the second must be a no-op and neither may change what sounds. */
    function expectStableUnderTwoPasses(score: Score) {
        const heard = soundingEvents(score)
        score.minimizeAccidentals()
        expect(soundingEvents(score)).toEqual(heard)
        const once = describeScore(score)
        score.minimizeAccidentals()
        expect(describeScore(score), 'a second pass changes nothing').toEqual(once)
        expect(soundingEvents(score)).toEqual(heard)
        return once
    }

    /** Accidentals the engraver would draw, under the keys now in place, with no note allowed to move. */
    const drawn = (score: Score) => {
        const walk = score.measures.flatMap((m) => m.notes)
        return new AccidentalMinimizer(walk, new Set(), (note) => note.keySignature.fifths).drawnCount
    }

    it('E♭4 then E4 written in C major: the pass re-keys to E major, where D♯ and E are both free, and the pass after it agrees', () => {
        const score = makeScore(1)
        fill(score, 0, [q(p('E', 4, -1)), q(p('E', 4)), q(), q()])
        expectStableUnderTwoPasses(score)
        // Ranked on sound (pitch classes 3 and 4), the lightest key that draws nothing is E major.
        expect(score.measures[0].keySignature.fifths).toBe(4)
        expect(drawn(score)).toBe(0)
        expect(score.measures[0].notes[0].pitch?.name).toBe('D')
        expect(score.measures[0].notes[0].pitch?.alter).toBe(1)
    })

    it('a tie across the barline with both notes in the walk keeps one spelling on both sides', () => {
        const score = makeScore(2)
        fill(score, 0, [q(p('C', 4)), q(p('F', 4)), q(p('A', 4)), q(p('A', 4, 1), 'start')])
        fill(score, 1, [q(p('A', 4, 1)), q(p('C', 5)), q(p('F', 4)), q(p('D', 4))])
        expectStableUnderTwoPasses(score)
        const [first, second] = score.measures
        const start = first.notes[3].pitch
        const continuation = second.notes[0].pitch
        expect(continuation?.name).toBe(start?.name)
        expect(continuation?.alter).toBe(start?.alter)
        expect(second.notes[0].tiesBack).toBe(true)
    })

    it('enharmonic extremes: double accidentals in a seven-sharp key settle in one pass', () => {
        const score = makeScore(1)
        score.measures[0].setKeySignature(0, 7) // C♯ major
        fill(score, 0, [q(p('B', 4, -2)), q(p('F', 4, 2)), q(p('C', 5, -1)), q(p('E', 4, 1))])
        expectStableUnderTwoPasses(score)
        for (const note of score.measures[0].notes) expect(Math.abs(note.pitch?.alter ?? 0)).toBeLessThanOrEqual(1)
    })

    it('a redundant mid-bar key restatement does not carve the bar into regions on the second pass', () => {
        const score = makeScore(2)
        fill(score, 0, [q(p('E', 4, -1)), q(p('E', 4)), q(p('B', 4, -1)), q(p('A', 4, -1))])
        fill(score, 1, [q(p('D', 4, -1)), q(p('G', 4, -1)), q(p('C', 5)), q(p('F', 4))])
        score.measures[0].addKeySignature(2, 0) // restates C major mid-bar: invisible until the leading key moves
        expect(score.measures[0].midMeasureKeySignatures).toEqual([])
        expectStableUnderTwoPasses(score)
        expect(score.measures[0].midMeasureKeySignatures).toEqual([])
        expect(score.measures[0].keySignatures.filter((k) => k.beatPosition > 0)).toEqual([])
    })

    it('a transposing instrument is minimized on its written pitches and still sounds the same', () => {
        const score = makeScore(1)
        score.setInstrument(Instrument.Clarinet)
        fill(score, 0, [q(p('E', 4, -1)), q(p('E', 4)), q(p('B', 4, -1)), q(p('A', 4, -1))])
        const once = expectStableUnderTwoPasses(score)
        expect(once.instrument).toBe('clarinet')
    })
})
