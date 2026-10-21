import { DOTTED_FLAG_SCALE, LEDGER_LINE_EXTENSION, STAVE_LINE_DISTANCE, STEM_HEIGHT } from '@mushee/notation/engraving/constants'
import { Duration } from '@mushee/notation/model/Duration'
import { NoteLayout } from '@mushee/notation/model/layout/NoteLayout'
import { NoteWidth } from '@mushee/notation/model/layout/NoteWidth'
import { Staff } from '@mushee/notation/model/layout/Staff'
import { Note } from '@mushee/notation/model/Note'
import { Pitch } from '@mushee/notation/model/Pitch'
import { clef } from '@mushee/notation/testing'
import { describe, expect, it } from 'vitest'

/** A detached note's standalone layout under the treble clef (whose lines are the pitch lines). */
const layoutOf = (n: Note) => NoteLayout.preview(n, clef('treble'))

describe('NoteLayout', () => {
    it('uses notehead glyph for pitched notes', () => {
        const n = new Note({ duration: new Duration({ type: 'q' }), pitch: new Pitch({ name: 'C', octave: 4 }) })
        expect(layoutOf(n).glyphName).toBe('noteheadBlack')
    })

    it('uses rest glyph for rests', () => {
        const n = new Note({ duration: new Duration({ type: 'q' }) })
        expect(layoutOf(n).glyphName).toBe('restQuarter')
    })

    it('whole notes have no stem', () => {
        const n = new Note({ duration: new Duration({ type: 'w' }), pitch: new Pitch({ name: 'C', octave: 4 }) })
        expect(layoutOf(n).stem).toBeUndefined()
    })

    it('quarter notes have a stem', () => {
        const n = new Note({ duration: new Duration({ type: 'q' }), pitch: new Pitch({ name: 'C', octave: 4 }) })
        expect(layoutOf(n).stem).toBeDefined()
    })

    it('eighth notes have a flag', () => {
        const n = new Note({ duration: new Duration({ type: '8' }), pitch: new Pitch({ name: 'C', octave: 4 }) })
        expect(layoutOf(n).flag).toBeDefined()
    })

    it('a stem-up flag sits above the notehead', () => {
        // C4 is at line 0 (< 3) → stem up → flag pulled up from the notehead.
        const n = new Note({ duration: new Duration({ type: '8' }), pitch: new Pitch({ name: 'C', octave: 4 }) })
        expect(layoutOf(n).stem?.y2).toBe(layoutOf(n).noteY - STEM_HEIGHT)
        expect(layoutOf(n).flag?.y).toBe(layoutOf(n).noteY - STEM_HEIGHT)
    })

    it('a stem-down flag sits below the notehead', () => {
        // D5 is at line 4 (>= 3) → stem down → flag pushed down from the notehead.
        const n = new Note({ duration: new Duration({ type: '8' }), pitch: new Pitch({ name: 'D', octave: 5 }) })
        expect(n.stemDir).toBe('down')
        expect(layoutOf(n).stem?.y2).toBe(layoutOf(n).noteY + STEM_HEIGHT)
        expect(layoutOf(n).flag?.y).toBe(layoutOf(n).noteY + STEM_HEIGHT)
    })

    it('an undotted flag has no scale override', () => {
        const n = new Note({ duration: new Duration({ type: '8' }), pitch: new Pitch({ name: 'C', octave: 4 }) })
        expect(layoutOf(n).flag?.scale).toBeUndefined()
    })

    it('a dotted flag is shrunk via the dotted-flag scale', () => {
        const n = new Note({ duration: new Duration({ type: '8', dots: 1 }), pitch: new Pitch({ name: 'C', octave: 4 }) })
        expect(layoutOf(n).flag?.scale).toBe(DOTTED_FLAG_SCALE)
    })

    it('rests have no stem and no flag', () => {
        const n = new Note({ duration: new Duration({ type: '8' }) })
        expect(layoutOf(n).stem).toBeUndefined()
        expect(layoutOf(n).flag).toBeUndefined()
    })

    it('accidental is laid out when the layout context resolves one', () => {
        const sharp = new Note({ duration: new Duration({ type: 'q' }), pitch: new Pitch({ name: 'F', octave: 5, alter: 1 }) })
        const layout = new NoteLayout(sharp, { line: sharp.line, width: new NoteWidth(sharp, 'accidentalSharp') })
        expect(layout.accidental?.glyphName).toBe('accidentalSharp')
        expect(layout.accidental?.x).toBeLessThan(layout.noteX)
    })

    it('dots are laid out when duration is dotted', () => {
        const n = new Note({
            duration: new Duration({ type: 'q', dots: 2 }),
            pitch: new Pitch({ name: 'C', octave: 4 }),
        })
        expect(layoutOf(n).dots).toHaveLength(2)
    })

    it('lifts the dot half a space when the note sits on a staff line', () => {
        // C4 is at line 0 (integer → on a line) → dot lifted up by half a space.
        const n = new Note({ duration: new Duration({ type: 'q', dots: 1 }), pitch: new Pitch({ name: 'C', octave: 4 }) })
        expect(Number.isInteger(n.line)).toBe(true)
        expect(layoutOf(n).dots?.[0].y).toBe(layoutOf(n).noteY - STAVE_LINE_DISTANCE / 2)
    })

    it('leaves the dot centred when the note sits in a space', () => {
        // D4 is at line 0.5 (non-integer → in a space) → dot stays on the note's own Y.
        const n = new Note({ duration: new Duration({ type: 'q', dots: 1 }), pitch: new Pitch({ name: 'D', octave: 4 }) })
        expect(Number.isInteger(n.line)).toBe(false)
        expect(layoutOf(n).dots?.[0].y).toBe(layoutOf(n).noteY)
    })

    it('low notes (line < 1) get ledger lines below the staff', () => {
        // C4 is at line 0 → ledger lines from line 0 down to itself
        const n = new Note({
            duration: new Duration({ type: 'q' }),
            pitch: new Pitch({ name: 'C', octave: 4 }),
        })
        expect(layoutOf(n).ledgerLines.length).toBeGreaterThan(0)
    })

    it('high notes (line > 5) get ledger lines above the staff', () => {
        const n = new Note({
            duration: new Duration({ type: 'q' }),
            pitch: new Pitch({ name: 'C', octave: 6 }),
        })
        expect(layoutOf(n).ledgerLines.length).toBeGreaterThan(0)
    })

    it('places ledger lines only on whole-line positions for a note in a space above the staff', () => {
        // B5 sits at line 6.5 (in the space above the first ledger line). The whole line at 6
        // gets a ledger line; the half-step space at 6.5 itself does not.
        const n = new Note({ duration: new Duration({ type: 'q' }), pitch: new Pitch({ name: 'B', octave: 5 }) })
        expect(Number.isInteger(n.line)).toBe(false)
        expect(n.line).toBeGreaterThan(5)
        expect(layoutOf(n).ledgerLines).toHaveLength(1)
    })

    it('places ledger lines only on whole-line positions for a note in a space below the staff', () => {
        // B3 sits at line -0.5 (in the space below line 0). The whole line at 0 gets a ledger
        // line; the half-step space at -0.5 does not.
        const n = new Note({ duration: new Duration({ type: 'q' }), pitch: new Pitch({ name: 'B', octave: 3 }) })
        expect(Number.isInteger(n.line)).toBe(false)
        expect(n.line).toBeLessThan(1)
        expect(layoutOf(n).ledgerLines).toHaveLength(1)
    })

    it('a whole note’s ledger line spans its whole notehead plus the extension on each side', () => {
        // C4 sits on the first ledger line below the staff; mock noteheadWhole width = 14.
        const n = new Note({ duration: new Duration({ type: 'w' }), pitch: new Pitch({ name: 'C', octave: 4 }) })
        const [ledger] = layoutOf(n).ledgerLines
        expect(layoutOf(n).ledgerLines).toHaveLength(1)
        expect(ledger.x2 - ledger.x1).toBe(14 + 2 * LEDGER_LINE_EXTENSION)
        expect(ledger.x1).toBe(layoutOf(n).noteX - LEDGER_LINE_EXTENSION)
        expect(layoutOf(n).noteRightX).toBe(layoutOf(n).noteX + 14)
    })

    describe('preview (the ghost note)', () => {
        it('lays the note out on its line under the supplied clef', () => {
            const n = new Note({ duration: new Duration(), pitch: new Pitch({ name: 'C', octave: 4 }) })
            const bass = clef('bass')
            const preview = NoteLayout.preview(n, bass)
            expect(preview.noteY).toBe(Staff.yForNoteLine(bass.lineFor(n.pitch as Pitch)))
            expect(preview.noteY).not.toBe(layoutOf(n).noteY) // the line really moved
            // C4 sits high in the bass clef → the stem follows the previewed line, not the pitch's treble line.
            expect(preview.stem?.y2).toBeGreaterThan(preview.noteY)
        })

        it('draws no accidental — with no bar around it there is none to resolve', () => {
            const flat = new Note({ duration: new Duration(), pitch: new Pitch({ name: 'C', octave: 4, alter: -1 }) })
            expect(NoteLayout.preview(flat, clef('bass')).accidental).toBeUndefined()
        })

        it('lays a rest out on its rest line with the rest glyph', () => {
            const r = new Note({ duration: new Duration({ type: 'w' }) })
            const preview = NoteLayout.preview(r, clef('bass'))
            expect(preview.glyphName).toBe(r.duration.restGlyph)
            expect(preview.noteY).toBe(Staff.yForNoteLine(r.duration.restLine))
            expect(preview.accidental).toBeUndefined()
        })

        it('builds a fresh snapshot each time (callers memoise it)', () => {
            const n = new Note({ duration: new Duration(), pitch: new Pitch({ name: 'C', octave: 4 }) })
            expect(NoteLayout.preview(n, clef('treble')).id).not.toBe(NoteLayout.preview(n, clef('treble')).id)
        })
    })

    it('no ledger lines for a note inside the staff', () => {
        // G4 is at line 2 (inside the staff) → no ledger lines.
        const n = new Note({ duration: new Duration({ type: 'q' }), pitch: new Pitch({ name: 'G', octave: 4 }) })
        expect(layoutOf(n).ledgerLines).toHaveLength(0)
    })
})
