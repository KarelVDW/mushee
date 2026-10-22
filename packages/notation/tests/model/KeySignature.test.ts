import { KeySignature } from '@mushee/notation/model/KeySignature'
import { Pitch } from '@mushee/notation/model/Pitch'
import { key, makeScore } from '@mushee/notation/testing'
import { describe, expect, it } from 'vitest'

describe('KeySignature', () => {
    /** The key's alteration of each letter, C to B. */
    const alters = (fifths: number) => (['C', 'D', 'E', 'F', 'G', 'A', 'B'] as const).map((name) => key(fifths).alterForNote(name))

    it('C major (fifths=0) has no sharps or flats', () => {
        expect(alters(0)).toEqual([0, 0, 0, 0, 0, 0, 0])
    })

    it('G major (fifths=1) has F#', () => {
        const k = key(1)
        expect(alters(1)).toEqual([0, 0, 0, 1, 0, 0, 0])
        expect(k.alterForNote('F')).toBe(1)
        expect(k.alterForNote('C')).toBe(0)
    })

    it('D major (fifths=2) has F# and C#', () => {
        expect(alters(2)).toEqual([1, 0, 0, 1, 0, 0, 0])
    })

    it('F major (fifths=-1) has Bb', () => {
        const k = key(-1)
        expect(alters(-1)).toEqual([0, 0, 0, 0, 0, 0, -1])
        expect(k.alterForNote('B')).toBe(-1)
    })

    it('Bb major (fifths=-2) has Bb and Eb', () => {
        expect(alters(-2)).toEqual([0, 0, -1, 0, 0, 0, -1])
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
        expect(alters(7)).toEqual([1, 1, 1, 1, 1, 1, 1])
    })

    it('handles all 7 flats (Cb major)', () => {
        expect(alters(-7)).toEqual([-1, -1, -1, -1, -1, -1, -1])
    })

    it('majorKeyName names the major tonic of every drawable key', () => {
        const names = Array.from({ length: 15 }, (_, i) => KeySignature.majorKeyName(i - 7))
        expect(names).toEqual(['C♭', 'G♭', 'D♭', 'A♭', 'E♭', 'B♭', 'F', 'C', 'G', 'D', 'A', 'E', 'B', 'F♯', 'C♯'])
    })

    describe('displayName (user copy)', () => {
        it('names major keys by their tonic', () => {
            expect(key(0).displayName).toBe('C major')
            expect(key(2).displayName).toBe('D major')
            expect(key(-3).displayName).toBe('E♭ major')
            expect(key(6).displayName).toBe('F♯ major')
            expect(key(2, 'major').displayName).toBe('D major')
        })

        it('names a minor key by its own tonic, three fifths up', () => {
            expect(key(0, 'minor').displayName).toBe('A minor')
            expect(key(-3, 'minor').displayName).toBe('C minor')
            expect(key(5, 'minor').displayName).toBe('G♯ minor')
            expect(key(-7, 'minor').displayName).toBe('A♭ minor')
        })

        it('readingsOf gives both keys a signature can stand for', () => {
            expect(KeySignature.readingsOf(2)).toBe('D major · B minor')
            expect(KeySignature.readingsOf(0)).toBe('C major · A minor')
            expect(KeySignature.readingsOf(-3)).toBe('E♭ major · C minor')
        })
    })

    describe('key identity (fifths, mode)', () => {
        it('sameKeyAs compares fifths and mode — relative major and minor are different keys', () => {
            expect(key(0).sameKeyAs(0)).toBe(true)
            expect(key(0, 'minor').sameKeyAs(0, 'minor')).toBe(true)
            expect(key(0).sameKeyAs(0, 'minor')).toBe(false)
            expect(key(0, 'major').sameKeyAs(0)).toBe(false) // an explicit 'major' is not the same as no mode
            expect(key(1).sameKeyAs(2)).toBe(false)
        })

        it('same takes plain values, and reads no key at all as C major with no mode', () => {
            expect(KeySignature.same({ fifths: 2, mode: 'major' }, 2, 'major')).toBe(true)
            expect(KeySignature.same({ fifths: 2, mode: 'major' }, 2, 'minor')).toBe(false)
            expect(KeySignature.same(undefined, 0)).toBe(true)
            expect(KeySignature.same(undefined, 0, 'major')).toBe(false)
            expect(KeySignature.same(undefined, 1)).toBe(false)
        })
    })

    describe('accidentalsForFifths (a key’s own glyphs)', () => {
        it('C major draws nothing', () => {
            expect(KeySignature.accidentalsForFifths(0)).toEqual([])
        })

        it('G major draws one sharp on F', () => {
            const accidentals = KeySignature.accidentalsForFifths(1)
            expect(accidentals).toHaveLength(1)
            expect(accidentals[0].glyphName).toBe('accidentalSharp')
            expect(accidentals[0].name).toBe('F')
        })

        it('Bb major draws two flats (B then E)', () => {
            const accidentals = KeySignature.accidentalsForFifths(-2)
            expect(accidentals.map((a) => a.name)).toEqual(['B', 'E'])
            expect(accidentals.every((a) => a.glyphName === 'accidentalFlat')).toBe(true)
        })

        it('D major draws F then C', () => {
            expect(KeySignature.accidentalsForFifths(2).map((a) => a.name)).toEqual(['F', 'C'])
        })
    })

    describe("layout (built by its measure's layout)", () => {
        it('is stable without mutation and rebuilt after a relevant change', () => {
            const score = makeScore(1)
            const m = score.measures[0]
            score.setKeySignature(m.firstNote, 1)
            const before = m.layout.keyLayoutFor(m.keySignature)
            expect(m.layout.keyLayoutFor(m.keySignature)).toBe(before)
            m.setClef(0, 'bass') // the key draws on different lines under a new clef
            expect(m.layout.keyLayoutFor(m.keySignature)).not.toBe(before)
        })
    })

    describe('spell (note entry)', () => {
        it('sharpens a pitch whose letter the key sharps, without a drawn accidental', () => {
            const p = key(1).spell(new Pitch({ name: 'F', octave: 4 })) // G major
            expect(p.name).toBe('F')
            expect(p.octave).toBe(4)
            expect(p.alter).toBe(1) // F♯
            // Whether a sharp is drawn is the layout layer's call (none: the key implies it).
            expect(new Pitch({ name: 'F', octave: 4, alter: 1 })).toEqual(p)
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

    describe('alterInKey (static alteration lookup)', () => {
        it('matches the instance alterForNote for sharps, flats, and naturals', () => {
            expect(KeySignature.alterInKey(2, 'F')).toBe(1) // D major sharps F
            expect(KeySignature.alterInKey(2, 'G')).toBe(0) // …but not G
            expect(KeySignature.alterInKey(-3, 'E')).toBe(-1) // E♭ major flats E
            expect(KeySignature.alterInKey(-3, 'D')).toBe(0)
            expect(KeySignature.alterInKey(0, 'B')).toBe(0)
            expect(key(4).alterForNote('D')).toBe(1) // instance method delegates
        })
    })

    describe('normalizedFifths (fold into the drawable range)', () => {
        it('keeps in-range values, even where an enharmonic partner is simpler', () => {
            expect(KeySignature.normalizedFifths(0)).toBe(0)
            expect(KeySignature.normalizedFifths(7)).toBe(7)
            expect(KeySignature.normalizedFifths(-7)).toBe(-7)
        })

        it('swaps an overflowed key for its enharmonic equivalent', () => {
            expect(KeySignature.normalizedFifths(8)).toBe(-4) // G♯ major → A♭ major
            expect(KeySignature.normalizedFifths(-9)).toBe(3) // F𝄫-side → A major
            expect(KeySignature.normalizedFifths(20)).toBe(-4) // wraps repeatedly
        })
    })
})
