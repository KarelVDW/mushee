// The engraving scale on its own, import-free: layout constants and renderers read it at
// module init, and test suites replace the Bravura module (never this one), so a mocked
// font can't zero out the scales derived from it.

/** Point size for notation glyphs (from VexFlow Tables.NOTATION_FONT_SCALE). */
const NOTATION_FONT_SCALE = 39

/**
 * Bravura's units per em. Must equal `BravuraFont.resolution` in bravura_glyphs.ts; kept
 * as a literal so reading the scale never loads the font data.
 */
const FONT_RESOLUTION = 1000

/** Scale factor to convert font units to SVG pixels. */
export const GLYPH_SCALE = (NOTATION_FONT_SCALE * 72) / (FONT_RESOLUTION * 100) // ≈ 0.02808
