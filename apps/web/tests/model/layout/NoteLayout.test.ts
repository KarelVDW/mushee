import { describe, expect, it } from 'vitest'

import { DOTTED_FLAG_SCALE, STAVE_LINE_DISTANCE } from '@/components/notation/constants'
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

    it('a stem-up flag sits above the notehead', () => {
        // C4 is at line 0 (< 3) → stem up → flag pulled up from the notehead.
        const n = new Note({ duration: new Duration({ type: '8' }), pitch: new Pitch({ name: 'C', octave: 4 }) })
        expect(n.layout.stem?.y2).toBe(n.layout.noteY - n.width.stemHeight)
        expect(n.layout.flag?.y).toBe(n.layout.noteY - n.width.stemHeight)
    })

    it('a stem-down flag sits below the notehead', () => {
        // D5 is at line 4 (>= 3) → stem down → flag pushed down from the notehead.
        const n = new Note({ duration: new Duration({ type: '8' }), pitch: new Pitch({ name: 'D', octave: 5 }) })
        expect(n.stemDir).toBe('down')
        expect(n.layout.stem?.y2).toBe(n.layout.noteY + n.width.stemHeight)
        expect(n.layout.flag?.y).toBe(n.layout.noteY + n.width.stemHeight)
    })

    it('an undotted flag has no scale override', () => {
        const n = new Note({ duration: new Duration({ type: '8' }), pitch: new Pitch({ name: 'C', octave: 4 }) })
        expect(n.layout.flag?.scale).toBeUndefined()
    })

    it('a dotted flag is shrunk via the dotted-flag scale', () => {
        const n = new Note({ duration: new Duration({ type: '8', dots: 1 }), pitch: new Pitch({ name: 'C', octave: 4 }) })
        expect(n.layout.flag?.scale).toBe(DOTTED_FLAG_SCALE)
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

    it('lifts the dot half a space when the note sits on a staff line', () => {
        // C4 is at line 0 (integer → on a line) → dot lifted up by half a space.
        const n = new Note({ duration: new Duration({ type: 'q', dots: 1 }), pitch: new Pitch({ name: 'C', octave: 4 }) })
        expect(Number.isInteger(n.line)).toBe(true)
        expect(n.layout.dots?.[0].y).toBe(n.layout.noteY - STAVE_LINE_DISTANCE / 2)
    })

    it('leaves the dot centred when the note sits in a space', () => {
        // D4 is at line 0.5 (non-integer → in a space) → dot stays on the note's own Y.
        const n = new Note({ duration: new Duration({ type: 'q', dots: 1 }), pitch: new Pitch({ name: 'D', octave: 4 }) })
        expect(Number.isInteger(n.line)).toBe(false)
        expect(n.layout.dots?.[0].y).toBe(n.layout.noteY)
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

    it('places ledger lines only on whole-line positions for a note in a space above the staff', () => {
        // B5 sits at line 6.5 (in the space above the first ledger line). The whole line at 6
        // gets a ledger line; the half-step space at 6.5 itself does not.
        const n = new Note({ duration: new Duration({ type: 'q' }), pitch: new Pitch({ name: 'B', octave: 5 }) })
        expect(Number.isInteger(n.line)).toBe(false)
        expect(n.line).toBeGreaterThan(5)
        expect(n.layout.ledgerLines).toHaveLength(1)
    })

    it('places ledger lines only on whole-line positions for a note in a space below the staff', () => {
        // B3 sits at line -0.5 (in the space below line 0). The whole line at 0 gets a ledger
        // line; the half-step space at -0.5 does not.
        const n = new Note({ duration: new Duration({ type: 'q' }), pitch: new Pitch({ name: 'B', octave: 3 }) })
        expect(Number.isInteger(n.line)).toBe(false)
        expect(n.line).toBeLessThan(1)
        expect(n.layout.ledgerLines).toHaveLength(1)
    })

    it('no ledger lines for a note inside the staff', () => {
        // G4 is at line 2 (inside the staff) → no ledger lines.
        const n = new Note({ duration: new Duration({ type: 'q' }), pitch: new Pitch({ name: 'G', octave: 4 }) })
        expect(n.layout.ledgerLines).toHaveLength(0)
    })
})
