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
        expect(new Pitch({ name: 'C', octave: 4 }).accidentalGlyph).toBeUndefined()
    })

    it('toMidi computes correct MIDI numbers', () => {
        // Middle C = 60, A4 = 69, C5 = 72
        expect(new Pitch({ name: 'C', octave: 4 }).toMidi()).toBe(60)
        expect(new Pitch({ name: 'A', octave: 4 }).toMidi()).toBe(69)
        expect(new Pitch({ name: 'C', octave: 5 }).toMidi()).toBe(72)
        expect(new Pitch({ name: 'F', octave: 4, alter: 1 }).toMidi()).toBe(66)
    })

    it('fromLine round-trips with line for natural notes', () => {
        const original = new Pitch({ name: 'B', octave: 4 })
        const restored = Pitch.fromLine(original.line)
        expect(restored.name).toBe(original.name)
        expect(restored.octave).toBe(original.octave)
    })
})
