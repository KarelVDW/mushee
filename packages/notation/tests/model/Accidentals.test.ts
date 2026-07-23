import { Duration } from '@mushee/notation/model/Duration'
import { DisplayedAccidentals } from '@mushee/notation/model/layout/DisplayedAccidentals'
import { Measure } from '@mushee/notation/model/Measure'
import { Note } from '@mushee/notation/model/Note'
import { Pitch } from '@mushee/notation/model/Pitch'
import { Score } from '@mushee/notation/model/Score'
import { TimeSignature } from '@mushee/notation/model/TimeSignature'
import { describe, expect, it } from 'vitest'

const q = (name: string, octave: number, accidental?: string) =>
    new Note({
        duration: new Duration({ type: 'q' }),
        pitch: new Pitch({ name, octave, accidental, alter: Pitch.accidentalToAlter(accidental) }),
    })

/** An orphan measure (key + notes) — enough to exercise the measure-local accidental derivation. */
function bar(notes: Note[], fifths = 0): Measure {
    const m = new Measure(new Score(), 'treble', new TimeSignature(4, 4), { keyFifths: fifths })
    m.addNotes(notes)
    return m
}

/** The drawn accidental for `note` in its measure, resolved by the layout layer. */
function glyphFor(m: Measure, note: Note): string | undefined {
    return new DisplayedAccidentals(m).byNote.get(note)
}

describe('accidental display (full measure-aware)', () => {
    it('hides an accidental that the key signature already implies', () => {
        const fSharp = q('F', 4, '#')
        const m = bar([fSharp], 1) // G major: F is sharp
        expect(glyphFor(m, fSharp)).toBeUndefined()
    })

    it('hides a key-implied alteration even with no stored accidental glyph (a key-spelled note)', () => {
        // Mirrors KeySignature.spell output: alter set, accidental undefined.
        const fSharp = new Note({ duration: new Duration({ type: 'q' }), pitch: new Pitch({ name: 'F', octave: 4, alter: 1 }) })
        const m = bar([fSharp], 1) // G major
        expect(glyphFor(m, fSharp)).toBeUndefined()
    })

    it('shows a natural when a note contradicts the key signature', () => {
        const fNat = q('F', 4)
        const m = bar([fNat], 1) // G major: a natural F must be marked
        expect(glyphFor(m, fNat)).toBe('accidentalNatural')
    })

    it('carries an accidental to later same-pitch notes in the bar', () => {
        const first = q('F', 4, '#')
        const second = q('F', 4, '#')
        const m = bar([first, second]) // C major
        expect(glyphFor(m, first)).toBe('accidentalSharp')
        expect(glyphFor(m, second)).toBeUndefined() // sharp carries
    })

    it('marks a natural that cancels an earlier accidental in the bar', () => {
        const sharp = q('F', 4, '#')
        const nat = q('F', 4)
        const m = bar([sharp, nat]) // C major
        expect(glyphFor(m, sharp)).toBe('accidentalSharp')
        expect(glyphFor(m, nat)).toBe('accidentalNatural')
    })

    it('does not carry an accidental across octaves', () => {
        const low = q('F', 4, '#')
        const high = q('F', 5, '#')
        const m = bar([low, high]) // C major
        expect(glyphFor(m, low)).toBe('accidentalSharp')
        expect(glyphFor(m, high)).toBe('accidentalSharp') // different staff position, own accidental
    })

    it('shows nothing for a natural note in C major', () => {
        const f = q('F', 4)
        const m = bar([f])
        expect(glyphFor(m, f)).toBeUndefined()
    })

    it('rests never carry an accidental', () => {
        const restNote = new Note({ duration: new Duration({ type: 'q' }) })
        const m = bar([restNote], 1)
        expect(glyphFor(m, restNote)).toBeUndefined()
    })

    it('resets carried accidentals at a mid-measure key change', () => {
        const notes = [q('F', 4), q('F', 4), q('F', 4), q('F', 4)] // beats 0,1,2,3
        const m = bar(notes) // leading C major
        m.addKeySignature(2, 1) // G major from beat 2
        expect(glyphFor(m, notes[0])).toBeUndefined() // C major: F natural needs nothing
        expect(glyphFor(m, notes[2])).toBe('accidentalNatural') // G major: F natural is now marked
        expect(glyphFor(m, notes[3])).toBeUndefined() // the natural carries to beat 3
    })

    it('the resolved accidental reaches an attached note layout', () => {
        const score = new Score()
        const fNat = q('F', 4)
        // Explicit G major — otherwise addMeasure's carry-forward demotes the leading key to inherited C major.
        const measure = new Measure(score, 'treble', new TimeSignature(4, 4), { keyFifths: 1, leadingKeyExplicit: true })
        measure.addNotes([fNat])
        measure.complete()
        score.addMeasure(undefined, measure)
        expect(fNat.layout.accidental?.glyphName).toBe('accidentalNatural')
    })

    it('a detached note falls back to its own stored accidental (no measure context)', () => {
        const fSharp = q('F', 4, '#')
        expect(fSharp.layout.accidental?.glyphName).toBe('accidentalSharp')
    })
})
