import { DOT_SPACING, LEDGER_LINE_EXTENSION, NOTE_ELEMENT_GAP } from '@mushee/notation/engraving/constants'
import { Duration } from '@mushee/notation/model/Duration'
import { NoteWidth } from '@mushee/notation/model/layout/NoteWidth'
import { Note } from '@mushee/notation/model/Note'
import { Pitch } from '@mushee/notation/model/Pitch'
import { describe, expect, it } from 'vitest'

// Glyph widths come from the metrics mock: noteheadBlack 10, noteheadWhole 14, restQuarter 9, restWhole 12.
describe('NoteWidth', () => {
    it('plain note: content = ledger ext × 2 + notehead width', () => {
        const note = new Note({ duration: new Duration({ type: 'q' }), pitch: new Pitch({ name: 'C', octave: 4 }) })
        const w = new NoteWidth(note, undefined)
        expect(w.content).toBe(LEDGER_LINE_EXTENSION * 2 + w.noteHeadWidth)
    })

    it('total = paddingLeft + content + paddingRight', () => {
        const note = new Note({ duration: new Duration({ type: 'q' }), pitch: new Pitch({ name: 'C', octave: 4 }) })
        const w = new NoteWidth(note, undefined)
        expect(w.total).toBe(w.paddingLeft + w.content + w.paddingRight)
    })

    it('accidental adds gap + accidental glyph width', () => {
        const plain = new Note({ duration: new Duration({ type: 'q' }), pitch: new Pitch({ name: 'C', octave: 4 }) })
        const sharp = new Note({ duration: new Duration({ type: 'q' }), pitch: new Pitch({ name: 'C', octave: 4, alter: 1 }) })
        expect(new NoteWidth(sharp, 'accidentalSharp').content).toBeGreaterThan(new NoteWidth(plain, undefined).content)
    })

    it('dots add gap + dotSpacing × dot count', () => {
        const plain = new Note({ duration: new Duration({ type: 'q' }) })
        const dotted = new Note({ duration: new Duration({ type: 'q', dots: 1 }) })
        const doubleDot = new Note({ duration: new Duration({ type: 'q', dots: 2 }) })
        const wPlain = new NoteWidth(plain, undefined)
        const wDotted = new NoteWidth(dotted, undefined)
        const wDouble = new NoteWidth(doubleDot, undefined)
        expect(wDotted.content).toBe(wPlain.content + NOTE_ELEMENT_GAP + DOT_SPACING)
        expect(wDouble.content).toBe(wPlain.content + NOTE_ELEMENT_GAP + DOT_SPACING * 2)
    })

    it('rest (no pitch) has no accidental contribution', () => {
        const rest = new Note({ duration: new Duration({ type: 'q' }) })
        const w = new NoteWidth(rest, undefined)
        expect(w.content).toBe(LEDGER_LINE_EXTENSION * 2 + w.noteHeadWidth)
    })

    it('measures the head glyph actually drawn: the notehead for a note, the rest glyph for a rest', () => {
        const quarter = new NoteWidth(new Note({ duration: new Duration({ type: 'q' }), pitch: new Pitch({ name: 'C', octave: 4 }) }), undefined)
        const whole = new NoteWidth(new Note({ duration: new Duration({ type: 'w' }), pitch: new Pitch({ name: 'C', octave: 4 }) }), undefined)
        const quarterRest = new NoteWidth(new Note({ duration: new Duration({ type: 'q' }) }), undefined)
        const wholeRest = new NoteWidth(new Note({ duration: new Duration({ type: 'w' }) }), undefined)
        expect([quarter.headGlyph, quarter.noteHeadWidth]).toEqual(['noteheadBlack', 10])
        expect([whole.headGlyph, whole.noteHeadWidth]).toEqual(['noteheadWhole', 14])
        expect([quarterRest.headGlyph, quarterRest.noteHeadWidth]).toEqual(['restQuarter', 9])
        expect([wholeRest.headGlyph, wholeRest.noteHeadWidth]).toEqual(['restWhole', 12])
    })

    it('width is positive', () => {
        const note = new Note({ duration: new Duration({ type: 'q' }) })
        expect(new NoteWidth(note, undefined).total).toBeGreaterThan(0)
    })
})
