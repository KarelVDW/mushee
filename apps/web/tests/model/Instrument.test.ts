import { describe, expect, it } from 'vitest'

import { Instrument } from '@/model/Instrument'
import { KeySignature } from '@/model/KeySignature'
import { Pitch } from '@/model/Pitch'

describe('Pitch.transposed', () => {
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
        const original = new Pitch({ name: 'F', alter: 1, accidental: '#', octave: 4 })
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

describe('KeySignature.transposedFifths', () => {
    it('shifts C major (0 fifths) up to D major (2 fifths) via flute → trumpet', () => {
        // Flute (chromatic 0, diatonic 0) → Trumpet (chromatic -2, diatonic -1)
        // delta = old - new = +2 chromatic, +1 diatonic; expected fifths shift = 7*2 - 12*1 = 2
        expect(KeySignature.transposedFifths(0, 2, 1)).toBe(2)
    })

    it('shifts G major (1 sharp) for trumpet → French horn', () => {
        // Trumpet (-2, -1) → French Horn (-7, -4): delta = 5 chromatic, 3 diatonic; shift = 7*5 - 12*3 = -1
        expect(KeySignature.transposedFifths(1, 5, 3)).toBe(0)
    })

    it('octave transposition does not change the key signature', () => {
        expect(KeySignature.transposedFifths(-3, 12, 7)).toBe(-3)
    })
})

describe('Instrument', () => {
    it('Piano is the default with no transposition', () => {
        expect(Instrument.Piano.chromaticTranspose).toBe(0)
        expect(Instrument.Piano.diatonicTranspose).toBe(0)
    })

    it('Trumpet transposes a major 2nd down', () => {
        expect(Instrument.Trumpet.chromaticTranspose).toBe(-2)
        expect(Instrument.Trumpet.diatonicTranspose).toBe(-1)
    })

    it('Piccolo sounds an octave above written', () => {
        expect(Instrument.Piccolo.chromaticTranspose).toBe(12)
        expect(Instrument.Piccolo.diatonicTranspose).toBe(7)
    })

    it('selectable() excludes the metronome Woodblock', () => {
        const ids = Instrument.selectable().map((i) => i.id)
        expect(ids).not.toContain('woodblock')
    })

    it('byGmProgram falls back to Piano for unknown programs', () => {
        expect(Instrument.byGmProgram(999)).toBe(Instrument.Piano)
    })
})
