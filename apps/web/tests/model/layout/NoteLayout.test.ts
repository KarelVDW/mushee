import { describe, expect, it } from 'vitest'

import { Duration } from '@/model/Duration'
import { Note } from '@/model/Note'
import { Pitch } from '@/model/Pitch'

describe('NoteLayout', () => {
    it('uses notehead glyph for pitched notes', () => {
        const n = new Note({ duration: new Duration({ type: 'q' }), pitch: new Pitch({ name: 'C', octave: 4 }) })
        expect(n.layout.glyphName).toBe('noteheadBlack')
    })

    it('uses rest glyph for rests', () => {
        const n = new Note({ duration: new Duration({ type: 'q' }) })
        expect(n.layout.glyphName).toBe('restQuarter')
    })

    it('whole notes have no stem', () => {
        const n = new Note({ duration: new Duration({ type: 'w' }), pitch: new Pitch({ name: 'C', octave: 4 }) })
        expect(n.layout.stem).toBeUndefined()
    })

    it('quarter notes have a stem', () => {
        const n = new Note({ duration: new Duration({ type: 'q' }), pitch: new Pitch({ name: 'C', octave: 4 }) })
        expect(n.layout.stem).toBeDefined()
    })

    it('eighth notes have a flag', () => {
        const n = new Note({ duration: new Duration({ type: '8' }), pitch: new Pitch({ name: 'C', octave: 4 }) })
        expect(n.layout.flag).toBeDefined()
    })

    it('rests have no stem and no flag', () => {
        const n = new Note({ duration: new Duration({ type: '8' }) })
        expect(n.layout.stem).toBeUndefined()
        expect(n.layout.flag).toBeUndefined()
    })

    it('accidental is laid out when pitch carries one', () => {
        const sharp = new Note({
            duration: new Duration({ type: 'q' }),
            pitch: new Pitch({ name: 'F', octave: 5, accidental: '#' }),
        })
        expect(sharp.layout.accidental?.glyphName).toBe('accidentalSharp')
    })

    it('dots are laid out when duration is dotted', () => {
        const n = new Note({
            duration: new Duration({ type: 'q', dots: 2 }),
            pitch: new Pitch({ name: 'C', octave: 4 }),
        })
        expect(n.layout.dots).toHaveLength(2)
    })

    it('low notes (line < 1) get ledger lines below the staff', () => {
        // C4 is at line 0 → ledger lines from line 0 down to itself
        const n = new Note({
            duration: new Duration({ type: 'q' }),
            pitch: new Pitch({ name: 'C', octave: 4 }),
        })
        expect(n.layout.ledgerLines.length).toBeGreaterThan(0)
    })

    it('high notes (line > 5) get ledger lines above the staff', () => {
        const n = new Note({
            duration: new Duration({ type: 'q' }),
            pitch: new Pitch({ name: 'C', octave: 6 }),
        })
        expect(n.layout.ledgerLines.length).toBeGreaterThan(0)
    })
})
