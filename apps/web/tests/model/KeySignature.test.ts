import { key } from '@test/helpers'
import { describe, expect, it } from 'vitest'

import { KeySignature } from '@/model/KeySignature'
import { Pitch } from '@/model/Pitch'

describe('KeySignature', () => {
    it('C major (fifths=0) has no sharps or flats', () => {
        const k = key(0)
        expect(k.sharps).toEqual([])
        expect(k.flats).toEqual([])
    })

    it('G major (fifths=1) has F#', () => {
        const k = key(1)
        expect(k.sharps).toEqual(['F'])
        expect(k.flats).toEqual([])
        expect(k.alterForNote('F')).toBe(1)
        expect(k.alterForNote('C')).toBe(0)
    })

    it('D major (fifths=2) has F# and C#', () => {
        expect(key(2).sharps).toEqual(['F', 'C'])
    })

    it('F major (fifths=-1) has Bb', () => {
        const k = key(-1)
        expect(k.flats).toEqual(['B'])
        expect(k.sharps).toEqual([])
        expect(k.alterForNote('B')).toBe(-1)
    })

    it('Bb major (fifths=-2) has Bb and Eb', () => {
        expect(key(-2).flats).toEqual(['B', 'E'])
    })

    it('mode is preserved if provided', () => {
        expect(key(0, 'minor').mode).toBe('minor')
    })

    it('alterForNote returns 0 for unaltered notes', () => {
        const k = key(2)
        expect(k.alterForNote('G')).toBe(0)
        expect(k.alterForNote('A')).toBe(0)
    })

    it('handles all 7 sharps (C# major)', () => {
        expect(key(7).sharps).toEqual(['F', 'C', 'G', 'D', 'A', 'E', 'B'])
    })

    it('handles all 7 flats (Cb major)', () => {
        expect(key(-7).flats).toEqual(['B', 'E', 'A', 'D', 'G', 'C', 'F'])
    })

    describe('accidentals (drawn glyphs)', () => {
        it('C major draws nothing', () => {
            expect(key(0).accidentals).toEqual([])
        })

        it('G major draws one sharp on F', () => {
            const accidentals = key(1).accidentals
            expect(accidentals).toHaveLength(1)
            expect(accidentals[0].glyphName).toBe('accidentalSharp')
            expect(accidentals[0].name).toBe('F')
        })

        it('Bb major draws two flats (B then E)', () => {
            const accidentals = key(-2).accidentals
            expect(accidentals.map((a) => a.name)).toEqual(['B', 'E'])
            expect(accidentals.every((a) => a.glyphName === 'accidentalFlat')).toBe(true)
        })
    })

    describe('spell (note entry)', () => {
        it('sharpens a pitch whose letter the key sharps, without a drawn accidental', () => {
            const p = key(1).spell(new Pitch({ name: 'F', octave: 4 })) // G major
            expect(p.name).toBe('F')
            expect(p.octave).toBe(4)
            expect(p.alter).toBe(1) // F♯
            expect(p.accidental).toBeUndefined() // implied by the key signature, not drawn
        })

        it('flattens a pitch whose letter the key flats', () => {
            expect(key(-2).spell(new Pitch({ name: 'B', octave: 4 })).alter).toBe(-1) // Bb major
        })

        it('leaves a pitch the key does not alter unchanged', () => {
            const p = new Pitch({ name: 'G', octave: 4 })
            expect(key(1).spell(p)).toBe(p)
        })
    })

    describe('transposedFifths', () => {
        it('shifts C major (0) up to D major (2) via flute → trumpet (+2 chromatic, +1 diatonic)', () => {
            expect(KeySignature.transposedFifths(0, 2, 1)).toBe(2)
        })

        it('shifts G major (1) for trumpet → French horn (+5 chromatic, +3 diatonic) to C major (0)', () => {
            expect(KeySignature.transposedFifths(1, 5, 3)).toBe(0)
        })

        it('octave transposition (12 chromatic, 7 diatonic) does not change fifths', () => {
            expect(KeySignature.transposedFifths(-3, 12, 7)).toBe(-3)
        })
    })
})
