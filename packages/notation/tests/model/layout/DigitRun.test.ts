import { TUPLET_NUMBER_SCALE } from '@mushee/notation/engraving/constants'
import { GLYPH_SCALE } from '@mushee/notation/engraving/GlyphScale'
import { DigitRun } from '@mushee/notation/model/layout/DigitRun'
import { describe, expect, it } from 'vitest'

// Widths come from the glyph-metrics mock: timeSig1 = 5, every other digit = 7.
describe('DigitRun', () => {
    it('spells a number as one timeSig glyph per digit', () => {
        expect(new DigitRun(4).glyphNames).toEqual(['timeSig4'])
        expect(new DigitRun(12).glyphNames).toEqual(['timeSig1', 'timeSig2'])
        expect(new DigitRun(10).glyphNames).toEqual(['timeSig1', 'timeSig0'])
    })

    it('refuses a number with no digit figures: a sign, a decimal point, NaN', () => {
        expect(() => new DigitRun(-3)).toThrow('DigitRun engraves whole numbers; got -3')
        expect(() => new DigitRun(1.5)).toThrow('got 1.5')
        expect(() => new DigitRun(NaN)).toThrow('got NaN')
    })

    it('is as wide as its digits laid side by side', () => {
        expect(new DigitRun(8).width).toBe(7)
        expect(new DigitRun(12).width).toBe(12)
    })

    it('centres its glyphs on cx, each digit after the previous one at its own width', () => {
        const glyphs = new DigitRun(12).centredAt(100, 40)
        expect(glyphs.map((g) => g.x)).toEqual([94, 99])
        expect(glyphs.every((g) => g.y === 40)).toBe(true)
    })

    it('stamps every glyph with the run scale, the engraving scale by default', () => {
        expect(new DigitRun(3).centredAt(0, 0)[0].scale).toBe(GLYPH_SCALE)
        expect(new DigitRun(3, TUPLET_NUMBER_SCALE).centredAt(0, 0)[0].scale).toBe(TUPLET_NUMBER_SCALE)
    })
})
