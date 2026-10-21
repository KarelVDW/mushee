import { Instrument } from '@mushee/notation/model/Instrument'
import { describe, expect, it } from 'vitest'

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

    it('all() returns the full registry including the metronome Woodblock', () => {
        const all = Instrument.all()
        expect(all).toContain(Instrument.Piano)
        expect(all).toContain(Instrument.Woodblock)
        // selectable() is the same set minus Woodblock.
        expect(all.length).toBe(Instrument.selectable().length + 1)
    })

    it('byId resolves a registered instrument and returns undefined for an unknown id', () => {
        expect(Instrument.byId('trumpet')).toBe(Instrument.Trumpet)
        expect(Instrument.byId('not-an-instrument')).toBeUndefined()
    })

    it('byDisplayName matches case-insensitively after trimming', () => {
        expect(Instrument.byDisplayName('  fReNcH HoRn ')).toBe(Instrument.FrenchHorn)
        expect(Instrument.byDisplayName('Trumpet')).toBe(Instrument.Trumpet)
    })

    it('byDisplayName falls back to Piano for an unknown name', () => {
        expect(Instrument.byDisplayName('Theremin')).toBe(Instrument.Piano)
    })

    it('guitar and bass guitar sound an octave below written', () => {
        expect(Instrument.Guitar.chromaticTranspose).toBe(-12)
        expect(Instrument.Guitar.diatonicTranspose).toBe(-7)
        expect(Instrument.BassGuitar.chromaticTranspose).toBe(-12)
        expect(Instrument.BassGuitar.diatonicTranspose).toBe(-7)
    })
})

describe('Instrument.selectableByCategory', () => {
    it('covers every selectable instrument exactly once', () => {
        const grouped = Instrument.selectableByCategory().flatMap((g) => g.instruments)
        expect(grouped.length).toBe(Instrument.selectable().length)
        expect(new Set(grouped).size).toBe(grouped.length)
    })

    it('places each instrument in its own category group', () => {
        for (const { category, instruments } of Instrument.selectableByCategory()) {
            for (const instrument of instruments) expect(instrument.category).toBe(category)
        }
    })

    it('lists families in fixed display order without the percussion-only group', () => {
        const categories = Instrument.selectableByCategory().map((g) => g.category)
        expect(categories).toEqual(['Keyboard', 'Brass', 'Woodwinds', 'Voice', 'Strings', 'Folk & World'])
    })

    it('sorts instruments alphabetically within each family', () => {
        for (const { instruments } of Instrument.selectableByCategory()) {
            const names = instruments.map((i) => i.displayName)
            expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)))
        }
    })

    it('keeps the metronome Woodblock out of every group', () => {
        expect(Instrument.Woodblock.category).toBe('Percussion')
        const grouped = Instrument.selectableByCategory().flatMap((g) => g.instruments)
        expect(grouped).not.toContain(Instrument.Woodblock)
    })
})
