import { Duration } from '@mushee/notation/model/Duration'
import { Note } from '@mushee/notation/model/Note'
import { Pitch } from '@mushee/notation/model/Pitch'
import { Score } from '@mushee/notation/model/Score'
import { makeScore } from '@mushee/notation/testing'
import { describe, expect, it } from 'vitest'

const q = (pitch?: Pitch, tie?: 'start' | 'stop') => new Note({ duration: new Duration({ type: 'q' }), pitch, tie })

const p = (name: string, octave: number, alter = 0) => new Pitch({ name, octave, alter })

/** Replace a 4/4 measure's four rests with the given four notes. */
function fill(score: Score, measureIndex: number, notes: Note[]) {
    const measure = score.measures[measureIndex]
    score.replace(measure.notes, notes)
    return measure
}

const spellingsIn = (score: Score, measureIndex: number) =>
    score.measures[measureIndex].notes.map((n) =>
        n.pitch ? `${n.pitch.name}${n.pitch.alter > 0 ? '#'.repeat(n.pitch.alter) : 'b'.repeat(-n.pitch.alter)}${n.pitch.octave}` : 'rest',
    )

describe('Score.transpose', () => {
    it('a unison is a no-op returning the untouched targets', () => {
        const score = makeScore(1)
        fill(score, 0, [q(p('C', 4)), q(p('D', 4)), q(), q()])
        const before = score.version
        const result = score.transpose(0, 0)
        expect(score.version).toBe(before)
        expect(result).toEqual(score.measures[0].notes)
    })

    it('moves the whole score: notes and key signatures together, sounding pitch shifted exactly', () => {
        const score = makeScore(1)
        const m = fill(score, 0, [q(p('G', 4)), q(p('A', 4)), q(p('B', 4)), q()])
        m.setKeySignature(0, 1) // G major
        score.transpose(2, 1) // up a major second
        expect(score.measures[0].keySignature.fifths).toBe(3) // A major
        expect(spellingsIn(score, 0)).toEqual(['A4', 'B4', 'C#5', 'rest'])
    })

    it('promotes an inherited leading C-major key to an explicit transposed boundary', () => {
        const score = makeScore(2)
        fill(score, 0, [q(p('C', 4)), q(p('E', 4)), q(p('G', 4)), q()])
        expect(score.measures[0].leadingKeyExplicit).toBe(false)
        score.transpose(2, 1)
        expect(score.measures[0].leadingKeyExplicit).toBe(true)
        expect(score.measures[0].keySignature.fifths).toBe(2) // D major
        expect(score.measures[1].keySignature.fifths).toBe(2) // carried forward
        expect(spellingsIn(score, 0)).toEqual(['D4', 'F#4', 'A4', 'rest'])
    })

    it('an octave transposition leaves an inherited C-major key inherited', () => {
        const score = makeScore(1)
        fill(score, 0, [q(p('C', 4)), q(p('E', 4)), q(p('G', 4)), q()])
        score.transpose(12, 7)
        expect(score.measures[0].leadingKeyExplicit).toBe(false)
        expect(score.measures[0].keySignature.fifths).toBe(0)
        expect(spellingsIn(score, 0)).toEqual(['C5', 'E5', 'G5', 'rest'])
    })

    it('folds an overflowing key to its enharmonic equivalent and respells the notes to match', () => {
        const score = makeScore(1)
        const m = fill(score, 0, [q(p('F', 4, 1)), q(p('A', 4, 1)), q(p('C', 5, 1)), q()])
        m.setKeySignature(0, 6) // F♯ major
        score.transpose(2, 1) // raw result would be G♯ major (+8)
        expect(score.measures[0].keySignature.fifths).toBe(-4) // A♭ major instead
        expect(spellingsIn(score, 0)).toEqual(['Ab4', 'C5', 'Eb5', 'rest'])
    })

    it('normalizes mid-measure key changes and leaves inherited leading keys to propagation', () => {
        const score = makeScore(2)
        const first = score.measures[0]
        first.setKeySignature(0, 6)
        first.addKeySignature(2, 5) // mid-measure change to B major
        fill(score, 0, [q(p('F', 4, 1)), q(), q(p('D', 5, 1)), q()])
        fill(score, 1, [q(p('D', 5, 1)), q(), q(), q()]) // measure 2 inherits B major
        expect(score.measures[1].leadingKeyExplicit).toBe(false)
        score.transpose(2, 1) // F♯ → +8 → A♭; B → +7 stays C♯
        expect(score.measures[0].keySignature.fifths).toBe(-4)
        expect(score.measures[0].keyAtBeat(2)?.fifths).toBe(7)
        expect(score.measures[1].keySignature.fifths).toBe(7) // re-derived by propagation
        expect(spellingsIn(score, 1)).toEqual(['E#5', 'rest', 'rest', 'rest'])
    })

    it('transposes only the given notes, leaving the key and the rest of the bar alone', () => {
        const score = makeScore(1)
        const m = fill(score, 0, [q(p('C', 4)), q(p('D', 4)), q(p('E', 4)), q()])
        const targets = [m.notes[0], m.notes[1]]
        const result = score.transpose(2, 1, targets)
        expect(result).toHaveLength(2)
        expect(m.keySignature.fifths).toBe(0)
        expect(spellingsIn(score, 0)).toEqual(['D4', 'E4', 'E4', 'rest'])
        expect(m.notes[0]).toBe(result[0]) // returned notes are the live replacements
    })

    it('respells the transposed result minimally (no double accidentals from the raw interval)', () => {
        const score = makeScore(1)
        const m = fill(score, 0, [q(p('F', 4, 1)), q(), q(), q()])
        m.setKeySignature(0, 0)
        // F♯ up an augmented unison is F𝄪 by raw interval math; the respell pass lands on G.
        score.transpose(1, 0, [m.notes[0]])
        expect(spellingsIn(score, 0)).toEqual(['G4', 'rest', 'rest', 'rest'])
    })

    it('rests travel through a transposition unchanged', () => {
        const score = makeScore(1)
        score.transpose(2, 1)
        expect(spellingsIn(score, 0)).toEqual(['rest', 'rest', 'rest', 'rest'])
    })

    it('a score with no measures transposes to nothing', () => {
        const score = new Score()
        expect(score.transpose(2, 1)).toEqual([])
    })
})

describe('Score.minimizeAccidentals', () => {
    it('re-keys the score to the signature that draws the least ink', () => {
        const score = makeScore(1)
        fill(score, 0, [q(p('G', 4, 1)), q(p('C', 5, 1)), q(p('D', 5, 1)), q(p('F', 4, 1))])
        score.minimizeAccidentals()
        expect(score.measures[0].keySignature.fifths).toBe(4) // E major holds all four sharps
        expect(spellingsIn(score, 0)).toEqual(['G#4', 'C#5', 'D#5', 'F#4'])
        expect(score.measures[0].leadingKeyExplicit).toBe(true)
    })

    it('flips sharp spellings to flats when the flat key wins (A♯ → B♭)', () => {
        const score = makeScore(1)
        fill(score, 0, [q(p('A', 4, 1)), q(p('D', 5, 1)), q(p('A', 4, 1)), q(p('F', 4))])
        score.minimizeAccidentals()
        // Pitch classes {B♭, E♭, F}: B♭ major covers them with two flats; the sharp-side
        // equivalent needs five sharps.
        expect(score.measures[0].keySignature.fifths).toBe(-2)
        expect(spellingsIn(score, 0)).toEqual(['Bb4', 'Eb5', 'Bb4', 'F4'])
    })

    it('keeps the current key when the notes cannot tell keys apart', () => {
        const score = makeScore(1)
        const m = fill(score, 0, [q(p('G', 4)), q(p('A', 4)), q(p('D', 5)), q()])
        m.setKeySignature(0, 1) // G major — no F in the melody, so C major would tie on ink
        score.minimizeAccidentals()
        expect(score.measures[0].keySignature.fifths).toBe(1)
    })

    it('prefers the sharp side of an otherwise-tied enharmonic pair', () => {
        const score = makeScore(2)
        fill(score, 0, [q(p('F', 4, 1)), q(p('G', 4, 1)), q(p('A', 4, 1)), q(p('C', 5, 1))])
        fill(score, 1, [q(p('D', 5, 1)), q(), q(), q()])
        score.minimizeAccidentals()
        // All five black keys: B major (5♯) and D♭ major (5♭) both cover them — sharps win the tie.
        expect(score.measures[0].keySignature.fifths).toBe(5)
    })

    it('re-keys each key region independently', () => {
        const score = makeScore(2)
        fill(score, 0, [q(p('F', 4, 1)), q(p('C', 5, 1)), q(p('G', 4, 1)), q()])
        const second = score.measures[1]
        second.setKeySignature(0, 0) // explicit boundary back to C
        fill(score, 1, [q(p('B', 4, -1)), q(p('E', 5, -1)), q(), q()])
        score.minimizeAccidentals()
        expect(score.measures[0].keySignature.fifths).toBe(3) // A major
        expect(score.measures[1].keySignature.fifths).toBe(-2) // B♭ major
        expect(spellingsIn(score, 0)).toEqual(['F#4', 'C#5', 'G#4', 'rest'])
        expect(spellingsIn(score, 1)).toEqual(['Bb4', 'Eb5', 'rest', 'rest'])
    })

    it('handles mid-measure key regions, including one after the last note', () => {
        const score = makeScore(2)
        const first = score.measures[0]
        first.addKeySignature(2, 1) // region boundary at beat 2
        first.addKeySignature(3.5, -5) // boundary after the last note's beat… almost: notes sit at 0,1,2,3
        fill(score, 0, [q(p('C', 4)), q(), q(p('F', 4, 1)), q(p('C', 5, 1))])
        fill(score, 1, [q(p('G', 4, 1)), q(), q(), q()])
        score.minimizeAccidentals()
        // Region 2 (beat 2 onward + measure 2 via… propagation from the last key −5): the beat-2
        // region holds F♯,C♯ and re-keys; the trailing −5 region governs measure 2's G♯.
        expect(score.measures[0].keyAtBeat(2)?.fifths).toBe(2) // D major covers F♯ + C♯
        expect(spellingsIn(score, 1)[0]).toBe('Ab4') // measure 2 sits in the A♭-side region
    })

    it('respells only the given notes when a selection is passed, keys untouched', () => {
        const score = makeScore(1)
        const m = fill(score, 0, [q(p('A', 4, 1)), q(p('A', 4, 1)), q(), q()])
        m.setKeySignature(0, -1) // F major: B♭ in key
        const result = score.minimizeAccidentals([m.notes[0]])
        expect(result).toHaveLength(1)
        expect(spellingsIn(score, 0)).toEqual(['Bb4', 'A#4', 'rest', 'rest'])
        expect(m.keySignature.fifths).toBe(-1)
    })

    it('returns notes index-aligned with the input, replacements and survivors alike', () => {
        const score = makeScore(1)
        const m = fill(score, 0, [q(p('C', 4)), q(p('A', 4, 1)), q(), q()])
        m.setKeySignature(0, -1)
        const [first, second] = score.minimizeAccidentals([m.notes[0], m.notes[1]])
        expect(first).toBe(m.notes[0]) // C4 was already minimal — same identity
        expect(second).toBe(m.notes[1]) // A♯ → B♭ — the fresh replacement
        expect(second.pitch?.name).toBe('B')
    })

    it('a key region with no notes at all is left alone', () => {
        const score = makeScore(1)
        const m = score.measures[0]
        fill(score, 0, [q(p('C', 4)), q(), q(), q()])
        m.addKeySignature(3.5, 3) // a region opening after the last note — nothing to weigh
        score.minimizeAccidentals()
        expect(m.keyAtBeat(3.5)?.fifths).toBe(3)
    })

    it('an empty selection is a no-op', () => {
        const score = makeScore(1)
        expect(score.minimizeAccidentals([])).toEqual([])
    })

    it('an all-rest score minimizes to itself', () => {
        const score = makeScore(1)
        const before = score.measures[0].notes
        const result = score.minimizeAccidentals()
        expect(result).toEqual(before)
        expect(score.measures[0].keySignature.fifths).toBe(0)
    })
})
