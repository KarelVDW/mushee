import { describe, expect, it } from 'vitest'

import { KeySignature } from '@/model/KeySignature'

describe('KeySignature', () => {
    it('C major (fifths=0) has no sharps or flats', () => {
        const k = new KeySignature(0)
        expect(k.sharps).toEqual([])
        expect(k.flats).toEqual([])
    })

    it('G major (fifths=1) has F#', () => {
        const k = new KeySignature(1)
        expect(k.sharps).toEqual(['F'])
        expect(k.flats).toEqual([])
        expect(k.alterForNote('F')).toBe(1)
        expect(k.alterForNote('C')).toBe(0)
    })

    it('D major (fifths=2) has F# and C#', () => {
        const k = new KeySignature(2)
        expect(k.sharps).toEqual(['F', 'C'])
    })

    it('F major (fifths=-1) has Bb', () => {
        const k = new KeySignature(-1)
        expect(k.flats).toEqual(['B'])
        expect(k.sharps).toEqual([])
        expect(k.alterForNote('B')).toBe(-1)
    })

    it('Bb major (fifths=-2) has Bb and Eb', () => {
        const k = new KeySignature(-2)
        expect(k.flats).toEqual(['B', 'E'])
    })

    it('mode is preserved if provided', () => {
        const k = new KeySignature(0, 'minor')
        expect(k.mode).toBe('minor')
    })

    it('alterForNote returns 0 for unaltered notes', () => {
        const k = new KeySignature(2)
        expect(k.alterForNote('G')).toBe(0)
        expect(k.alterForNote('A')).toBe(0)
    })

    it('handles all 7 sharps (C# major)', () => {
        const k = new KeySignature(7)
        expect(k.sharps).toEqual(['F', 'C', 'G', 'D', 'A', 'E', 'B'])
    })

    it('handles all 7 flats (Cb major)', () => {
        const k = new KeySignature(-7)
        expect(k.flats).toEqual(['B', 'E', 'A', 'D', 'G', 'C', 'F'])
    })
})
