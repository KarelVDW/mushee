import { describe, expect, it, vi } from 'vitest'

// Every other suite swaps Bravura for the width table; this one reads the real font.
vi.unmock('../../src/engraving/Bravura')

import { Bravura } from '@mushee/notation/engraving/Bravura'
import { BravuraFont } from '@mushee/notation/engraving/bravura_glyphs'
import { GLYPH_SCALE } from '@mushee/notation/engraving/GlyphScale'

describe('GLYPH_SCALE', () => {
    it("converts the font's units per em to pixels at the notation point size", () => {
        expect(GLYPH_SCALE).toBe((39 * 72) / (BravuraFont.resolution * 100))
    })
})

describe('Bravura', () => {
    it("measures a glyph by its outline's horizontal extent, control points included", () => {
        // noteheadBlack's outline spans x = 0 … 425 font units.
        expect(Bravura.width('noteheadBlack', 1)).toBe(425)
        expect(Bravura.width('noteheadBlack')).toBe(425 * GLYPH_SCALE)
    })

    it('throws when measuring a glyph the font lacks', () => {
        expect(() => Bravura.width('noSuchGlyph')).toThrow('noSuchGlyph')
    })

    it('draws the outline as SVG path data: y flipped, curve endpoints moved last', () => {
        expect(Bravura.svgPath('noteheadBlack', 1)).toBe(
            'M 140 180 C 268 180 425 62 425 -60 C 425 -134 367 -180 285 -180 C 127 -180 0 -63 0 60 C 0 135 62 180 140 180 Z',
        )
        expect(Bravura.svgPath('noteheadBlack', 2).startsWith('M 280 360 C')).toBe(true)
    })

    it('draws nothing for a glyph the font lacks', () => {
        expect(Bravura.svgPath('noSuchGlyph')).toBe('')
    })
})
