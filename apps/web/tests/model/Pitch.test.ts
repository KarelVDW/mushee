import { describe, expect, it } from 'vitest'

import { Pitch } from '@/model/Pitch'

describe('Pitch', () => {
    it('stores constructor values with default alter=0 and undefined accidental', () => {
        const p = new Pitch({ name: 'C', octave: 4 })
        expect(p.name).toBe('C')
        expect(p.alter).toBe(0)
        expect(p.accidental).toBeUndefined()
        expect(p.octave).toBe(4)
    })

    it('respects explicit alter and accidental', () => {
        const p = new Pitch({ name: 'F', octave: 5, alter: 1, accidental: '#' })
        expect(p.alter).toBe(1)
        expect(p.accidental).toBe('#')
    })

    describe('line (treble staff position)', () => {
        it('B4 sits on line 3 (middle line of treble)', () => {
            // Formula: (octave*7 - 28 + noteIndex) / 2
            // B4: noteIndex=6, baseIndex=0 → (0+6)/2 = 3
            expect(new Pitch({ name: 'B', octave: 4 }).line).toBe(3)
        })

        it('G4 sits on line 2 (G clef line)', () => {
            // G4: noteIndex=4, baseIndex=0 → (0+4)/2 = 2
            expect(new Pitch({ name: 'G', octave: 4 }).line).toBe(2)
        })

        it('C4 (middle C) is at line 0 by formula', () => {
            // C4: noteIndex=0, baseIndex=0 → 0
            expect(new Pitch({ name: 'C', octave: 4 }).line).toBe(0)
        })
    })

    // Clef-aware staff positions live on Clef.lineFor(pitch); see Clef.test.ts.

    describe('raised / lowered', () => {
        it('raised moves up half a line and returns a Pitch instance', () => {
            const p = new Pitch({ name: 'B', octave: 4 })
            const r = p.raised()
            expect(r).toBeInstanceOf(Pitch)
            expect(r.line).toBeCloseTo(p.line + 0.5)
        })

        it('lowered moves down half a line', () => {
            const p = new Pitch({ name: 'B', octave: 4 })
            expect(p.lowered().line).toBeCloseTo(p.line - 0.5)
        })
    })

    it('withAccidental produces a new Pitch with matching alter', () => {
        const p = new Pitch({ name: 'C', octave: 4 })
        const sharp = p.withAccidental('#')
        expect(sharp.accidental).toBe('#')
        expect(sharp.alter).toBe(1)
        expect(sharp).not.toBe(p)
    })

    it('accidentalToAlter maps glyphs correctly', () => {
        expect(Pitch.accidentalToAlter('#')).toBe(1)
        expect(Pitch.accidentalToAlter('b')).toBe(-1)
        expect(Pitch.accidentalToAlter('##')).toBe(2)
        expect(Pitch.accidentalToAlter('bb')).toBe(-2)
        expect(Pitch.accidentalToAlter('n')).toBe(0)
        expect(Pitch.accidentalToAlter(undefined)).toBe(0)
    })

    it('accidentalGlyph maps to font glyph names', () => {
        expect(new Pitch({ name: 'C', octave: 4, accidental: '#' }).accidentalGlyph).toBe('accidentalSharp')
        expect(new Pitch({ name: 'C', octave: 4, accidental: 'b' }).accidentalGlyph).toBe('accidentalFlat')
        expect(new Pitch({ name: 'C', octave: 4, accidental: '##' }).accidentalGlyph).toBe('accidentalDoubleSharp')
        expect(new Pitch({ name: 'C', octave: 4, accidental: 'bb' }).accidentalGlyph).toBe('accidentalDoubleFlat')
        expect(new Pitch({ name: 'C', octave: 4, accidental: 'n' }).accidentalGlyph).toBe('accidentalNatural')
        expect(new Pitch({ name: 'C', octave: 4 }).accidentalGlyph).toBeUndefined()
    })

    it('glyphForAlter maps an alteration to the matching glyph, undefined out of range', () => {
        expect(Pitch.glyphForAlter(0)).toBe('accidentalNatural')
        expect(Pitch.glyphForAlter(1)).toBe('accidentalSharp')
        expect(Pitch.glyphForAlter(-1)).toBe('accidentalFlat')
        expect(Pitch.glyphForAlter(2)).toBe('accidentalDoubleSharp')
        expect(Pitch.glyphForAlter(-2)).toBe('accidentalDoubleFlat')
        expect(Pitch.glyphForAlter(3)).toBeUndefined()
    })

    it('alterToAccidental maps an alteration to its token, undefined for natural/out of range', () => {
        expect(Pitch.alterToAccidental(1)).toBe('#')
        expect(Pitch.alterToAccidental(-1)).toBe('b')
        expect(Pitch.alterToAccidental(2)).toBe('##')
        expect(Pitch.alterToAccidental(-2)).toBe('bb')
        expect(Pitch.alterToAccidental(0)).toBeUndefined()
        expect(Pitch.alterToAccidental(3)).toBeUndefined()
    })

    it('toMidi computes correct MIDI numbers', () => {
        // Middle C = 60, A4 = 69, C5 = 72
        expect(new Pitch({ name: 'C', octave: 4 }).toMidi()).toBe(60)
        expect(new Pitch({ name: 'A', octave: 4 }).toMidi()).toBe(69)
        expect(new Pitch({ name: 'C', octave: 5 }).toMidi()).toBe(72)
        expect(new Pitch({ name: 'F', octave: 4, alter: 1 }).toMidi()).toBe(66)
    })

    it('toMidi treats an unknown step name as zero semitones from the octave base', () => {
        // SEMITONES has no entry for 'X', so it contributes 0 — (4+1)*12 = 60.
        expect(new Pitch({ name: 'X', octave: 4 }).toMidi()).toBe(60)
    })

    it('fromLine round-trips with line for natural notes', () => {
        const original = new Pitch({ name: 'B', octave: 4 })
        const restored = Pitch.fromLine(original.line)
        expect(restored.name).toBe(original.name)
        expect(restored.octave).toBe(original.octave)
    })

    describe('transposed', () => {
        it('shifts letter step and octave for a plain interval (up a major second)', () => {
            // C4 up a major 2nd → D4, natural (chromatic +2, diatonic +1).
            const d = new Pitch({ name: 'C', octave: 4 }).transposed(2, 1)
            expect(d.name).toBe('D')
            expect(d.octave).toBe(4)
            expect(d.alter).toBe(0)
            expect(d.accidental).toBeUndefined()
            expect(d.toMidi()).toBe(new Pitch({ name: 'C', octave: 4 }).toMidi() + 2)
        })

        it('derives the alter from the mismatch between chromatic and diatonic shift', () => {
            // C4 up a chromatic semitone but no letter change → C#4 (chromatic +1, diatonic 0).
            const cSharp = new Pitch({ name: 'C', octave: 4 }).transposed(1, 0)
            expect(cSharp.name).toBe('C')
            expect(cSharp.octave).toBe(4)
            expect(cSharp.alter).toBe(1)
            expect(cSharp.accidental).toBe('#')
        })

        it('crosses an octave boundary downward', () => {
            // C4 down a perfect octave → C3 (chromatic -12, diatonic -7).
            const c3 = new Pitch({ name: 'C', octave: 4 }).transposed(-12, -7)
            expect(c3.name).toBe('C')
            expect(c3.octave).toBe(3)
            expect(c3.alter).toBe(0)
        })

        it('preserves the existing alteration in the resulting MIDI', () => {
            // F#4 up a major 2nd → G#4 (chromatic +2, diatonic +1).
            const gSharp = new Pitch({ name: 'F', octave: 4, alter: 1 }).transposed(2, 1)
            expect(gSharp.name).toBe('G')
            expect(gSharp.alter).toBe(1)
            expect(gSharp.accidental).toBe('#')
        })

        it('throws for an unknown step name', () => {
            expect(() => new Pitch({ name: 'H', octave: 4 }).transposed(2, 1)).toThrow('Unknown step name: H')
        })
    })

    describe('accidentalValue (control token from alteration)', () => {
        it('derives from the alteration, not the stored accidental glyph', () => {
            // A key-spelled note carries the alteration but no stored accidental.
            expect(new Pitch({ name: 'F', octave: 4, alter: 1 }).accidentalValue).toBe('#')
            expect(new Pitch({ name: 'B', octave: 4, alter: -1 }).accidentalValue).toBe('b')
            expect(new Pitch({ name: 'C', octave: 4 }).accidentalValue).toBeUndefined()
        })

        it('matches the stored accidental for explicitly-altered notes', () => {
            expect(new Pitch({ name: 'F', octave: 5, accidental: '#', alter: 1 }).accidentalValue).toBe('#')
        })
    })
})
