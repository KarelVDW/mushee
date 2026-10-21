import { type Accidental, Pitch } from '@mushee/notation/model/Pitch'
import { describe, expect, it } from 'vitest'

describe('Pitch', () => {
    it('stores constructor values with default alter=0 (natural: no accidental token)', () => {
        const p = new Pitch({ name: 'C', octave: 4 })
        expect(p.name).toBe('C')
        expect(p.alter).toBe(0)
        expect(p.accidental).toBeUndefined()
        expect(p.octave).toBe(4)
    })

    it('respects an explicit alter, and derives the accidental token from it', () => {
        const p = new Pitch({ name: 'F', octave: 5, alter: 1 })
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

    it('withAccidental natural (token or none) clears the alteration', () => {
        const fSharp = new Pitch({ name: 'F', octave: 4, alter: 1 })
        for (const natural of ['n', undefined] as const) {
            const p = fSharp.withAccidental(natural)
            expect(p.alter).toBe(0)
            expect(p.accidental).toBeUndefined()
        }
    })

    describe('the accidental vocabulary (token ↔ alter ↔ glyph)', () => {
        // One row per token; natural is asymmetric on purpose — 'n' maps to alter 0 and the
        // natural glyph, but alter 0 maps back to no token (natural is the absence of one).
        const rows: Array<{ token: Accidental; alter: number; glyph: string; tokenOfAlter: Accidental | undefined }> = [
            { token: '#', alter: 1, glyph: 'accidentalSharp', tokenOfAlter: '#' },
            { token: 'b', alter: -1, glyph: 'accidentalFlat', tokenOfAlter: 'b' },
            { token: '##', alter: 2, glyph: 'accidentalDoubleSharp', tokenOfAlter: '##' },
            { token: 'bb', alter: -2, glyph: 'accidentalDoubleFlat', tokenOfAlter: 'bb' },
            { token: 'n', alter: 0, glyph: 'accidentalNatural', tokenOfAlter: undefined },
        ]

        it.each(rows)('$token: alter $alter, glyph $glyph, alter back to token $tokenOfAlter', ({ token, alter, glyph, tokenOfAlter }) => {
            expect(Pitch.accidentalToAlter(token)).toBe(alter)
            expect(Pitch.glyphForAlter(alter)).toBe(glyph)
            expect(Pitch.alterToAccidental(alter)).toBe(tokenOfAlter)
            expect(new Pitch({ name: 'C', octave: 4, alter }).accidental).toBe(tokenOfAlter)
        })

        it('no token is natural, and an alteration no token writes has neither token nor glyph', () => {
            expect(Pitch.accidentalToAlter(undefined)).toBe(0)
            expect(Pitch.alterToAccidental(3)).toBeUndefined()
            expect(Pitch.glyphForAlter(3)).toBeUndefined()
            expect(new Pitch({ name: 'C', octave: 4, alter: -3 }).accidental).toBeUndefined()
        })
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

    it('spelledLike compares the written spelling — letter, alteration and octave', () => {
        const cSharp4 = new Pitch({ name: 'C', alter: 1, octave: 4 })
        expect(cSharp4.spelledLike(new Pitch({ name: 'C', alter: 1, octave: 4 }))).toBe(true)
        expect(cSharp4.spelledLike(new Pitch({ name: 'D', alter: -1, octave: 4 }))).toBe(false) // enharmonic, sounds alike
        expect(cSharp4.spelledLike(new Pitch({ name: 'C', octave: 4 }))).toBe(false)
        expect(cSharp4.spelledLike(new Pitch({ name: 'C', alter: 1, octave: 5 }))).toBe(false)
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

        it('transposes C5 down by a major 2nd to B♭4 (trumpet writes C, sounds B♭)', () => {
            const c5 = new Pitch({ name: 'C', octave: 5 })
            const result = c5.transposed(-2, -1)
            expect(result.name).toBe('B')
            expect(result.octave).toBe(4)
            expect(result.alter).toBe(-1)
            expect(result.accidental).toBe('b')
        })

        it('transposes C5 up by an octave to C6 (piccolo writes C, sounds C an octave higher)', () => {
            const c5 = new Pitch({ name: 'C', octave: 5 })
            const result = c5.transposed(12, 7)
            expect(result.name).toBe('C')
            expect(result.octave).toBe(6)
            expect(result.alter).toBe(0)
        })

        it('transposes C5 down by a major 6th to E♭4 (alto sax)', () => {
            const c5 = new Pitch({ name: 'C', octave: 5 })
            const result = c5.transposed(-9, -5)
            expect(result.name).toBe('E')
            expect(result.octave).toBe(4)
            expect(result.alter).toBe(-1)
        })

        it('transposes C5 down by a perfect 5th to F4 (French horn)', () => {
            const c5 = new Pitch({ name: 'C', octave: 5 })
            const result = c5.transposed(-7, -4)
            expect(result.name).toBe('F')
            expect(result.octave).toBe(4)
            expect(result.alter).toBe(0)
        })

        it('preserves pitch identity through round-trip transposition', () => {
            const original = new Pitch({ name: 'F', alter: 1, octave: 4 })
            const round = original.transposed(-7, -4).transposed(7, 4)
            expect(round.name).toBe('F')
            expect(round.octave).toBe(4)
            expect(round.alter).toBe(1)
        })

        it('preserves the underlying MIDI relationship: written + chromatic = sounding', () => {
            const written = new Pitch({ name: 'D', alter: 1, octave: 4 })
            const sounding = written.transposed(-9, -5)
            expect(sounding.toMidi()).toBe(written.toMidi() - 9)
        })
    })

    describe('accidental (control token from alteration)', () => {
        it('derives from the alteration, whether or not an accidental is drawn', () => {
            // A key-spelled note (F♯ in G major) draws no accidental yet still reads as sharp.
            expect(new Pitch({ name: 'F', octave: 4, alter: 1 }).accidental).toBe('#')
            expect(new Pitch({ name: 'B', octave: 4, alter: -1 }).accidental).toBe('b')
            expect(new Pitch({ name: 'C', octave: 4 }).accidental).toBeUndefined()
        })
    })

    describe('octaveShifted (whole-octave transposition)', () => {
        it('moves whole octaves while preserving spelling and accidental', () => {
            const p = new Pitch({ name: 'F', octave: 5, alter: 1 })
            const down = p.octaveShifted(-2)
            expect(down.name).toBe('F')
            expect(down.octave).toBe(3)
            expect(down.alter).toBe(1)
            expect(down.accidental).toBe('#')
            expect(down.toMidi()).toBe(p.toMidi() - 24)
        })

        it('returns the same instance for a zero shift', () => {
            const p = new Pitch({ name: 'C', octave: 4 })
            expect(p.octaveShifted(0)).toBe(p)
        })
    })

    describe('spellingsOf (enharmonic candidates of a MIDI pitch)', () => {
        const spelledAs = (midi: number) => Pitch.spellingsOf(midi).map((p) => `${p.name}${p.accidental ?? ''}${p.octave}`)

        it('a black key spells as the sharp below and the flat above', () => {
            expect(spelledAs(61)).toEqual(['C#4', 'Db4'])
        })

        it('a white key includes its single-accidental neighbours, crossing the octave where needed', () => {
            expect(spelledAs(60)).toEqual(['C4', 'B#3']) // B♯ lives an octave label lower
            expect(spelledAs(64)).toEqual(['E4', 'Fb4'])
            expect(spelledAs(71)).toEqual(['Cb5', 'B4']) // C♭ lives an octave label higher
        })

        it('never offers double accidentals and every candidate sounds the requested pitch', () => {
            for (let midi = 48; midi < 72; midi++) {
                const spellings = Pitch.spellingsOf(midi)
                expect(spellings.length).toBeGreaterThan(0)
                for (const p of spellings) {
                    expect(Math.abs(p.alter)).toBeLessThanOrEqual(1)
                    expect(p.toMidi()).toBe(midi)
                }
            }
        })
    })
})
