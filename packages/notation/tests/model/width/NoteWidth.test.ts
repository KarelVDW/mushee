import { Duration } from '@mushee/notation/model/Duration'
import { Note } from '@mushee/notation/model/Note'
import { Pitch } from '@mushee/notation/model/Pitch'
import { NoteWidth } from '@mushee/notation/model/width/NoteWidth'
import { describe, expect, it } from 'vitest'

describe('NoteWidth', () => {
    it('plain note: content = ledger ext × 2 + notehead width', () => {
        const note = new Note({ duration: new Duration({ type: 'q' }), pitch: new Pitch({ name: 'C', octave: 4 }) })
        const w = new NoteWidth(note, undefined)
        expect(w.content).toBe(w.ledgerLineExtension * 2 + w.noteHeadWidth)
    })

    it('total = paddingLeft + content + paddingRight', () => {
        const note = new Note({ duration: new Duration({ type: 'q' }), pitch: new Pitch({ name: 'C', octave: 4 }) })
        const w = new NoteWidth(note, undefined)
        expect(w.total).toBe(w.paddingLeft + w.content + w.paddingRight)
    })

    it('accidental adds gap + accidental glyph width', () => {
        const plain = new Note({ duration: new Duration({ type: 'q' }), pitch: new Pitch({ name: 'C', octave: 4 }) })
        const sharp = new Note({ duration: new Duration({ type: 'q' }), pitch: new Pitch({ name: 'C', octave: 4, accidental: '#' }) })
        expect(new NoteWidth(sharp, sharp.pitch?.accidentalGlyph).content).toBeGreaterThan(new NoteWidth(plain, undefined).content)
    })

    it('dots add gap + dotSpacing × dot count', () => {
        const plain = new Note({ duration: new Duration({ type: 'q' }) })
        const dotted = new Note({ duration: new Duration({ type: 'q', dots: 1 }) })
        const doubleDot = new Note({ duration: new Duration({ type: 'q', dots: 2 }) })
        const wPlain = new NoteWidth(plain, undefined)
        const wDotted = new NoteWidth(dotted, undefined)
        const wDouble = new NoteWidth(doubleDot, undefined)
        expect(wDotted.content).toBe(wPlain.content + wPlain.gap + wPlain.dotSpacing)
        expect(wDouble.content).toBe(wPlain.content + wPlain.gap + wPlain.dotSpacing * 2)
    })

    it('rest (no pitch) has no accidental contribution', () => {
        const rest = new Note({ duration: new Duration({ type: 'q' }) })
        const w = new NoteWidth(rest, undefined)
        expect(w.content).toBe(w.ledgerLineExtension * 2 + w.noteHeadWidth)
    })

    it('width is positive', () => {
        const note = new Note({ duration: new Duration({ type: 'q' }) })
        expect(new NoteWidth(note, undefined).total).toBeGreaterThan(0)
    })
})
