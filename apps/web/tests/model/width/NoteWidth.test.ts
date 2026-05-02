import { describe, expect, it } from 'vitest'

import { Duration } from '@/model/Duration'
import { Note } from '@/model/Note'
import { Pitch } from '@/model/Pitch'
import { NoteWidth } from '@/model/width/NoteWidth'

describe('NoteWidth', () => {
    it('plain note: content = ledger ext × 2 + notehead width', () => {
        const note = new Note({ duration: new Duration({ type: 'q' }), pitch: new Pitch({ name: 'C', octave: 4 }) })
        const w = new NoteWidth(note)
        expect(w.content).toBe(w.ledgerLineExtension * 2 + w.noteHeadWidth)
    })

    it('total = paddingLeft + content + paddingRight', () => {
        const note = new Note({ duration: new Duration({ type: 'q' }), pitch: new Pitch({ name: 'C', octave: 4 }) })
        const w = new NoteWidth(note)
        expect(w.total).toBe(w.paddingLeft + w.content + w.paddingRight)
    })

    it('accidental adds gap + accidental glyph width', () => {
        const plain = new Note({ duration: new Duration({ type: 'q' }), pitch: new Pitch({ name: 'C', octave: 4 }) })
        const sharp = new Note({ duration: new Duration({ type: 'q' }), pitch: new Pitch({ name: 'C', octave: 4, accidental: '#' }) })
        expect(new NoteWidth(sharp).content).toBeGreaterThan(new NoteWidth(plain).content)
    })

    it('dots add gap + dotSpacing × dot count', () => {
        const plain = new Note({ duration: new Duration({ type: 'q' }) })
        const dotted = new Note({ duration: new Duration({ type: 'q', dots: 1 }) })
        const doubleDot = new Note({ duration: new Duration({ type: 'q', dots: 2 }) })
        const wPlain = new NoteWidth(plain)
        const wDotted = new NoteWidth(dotted)
        const wDouble = new NoteWidth(doubleDot)
        expect(wDotted.content).toBe(wPlain.content + wPlain.gap + wPlain.dotSpacing)
        expect(wDouble.content).toBe(wPlain.content + wPlain.gap + wPlain.dotSpacing * 2)
    })

    it('rest (no pitch) has no accidental contribution', () => {
        const rest = new Note({ duration: new Duration({ type: 'q' }) })
        const w = new NoteWidth(rest)
        expect(w.content).toBe(w.ledgerLineExtension * 2 + w.noteHeadWidth)
    })

    it('width is positive', () => {
        const note = new Note({ duration: new Duration({ type: 'q' }) })
        expect(new NoteWidth(note).total).toBeGreaterThan(0)
    })
})
