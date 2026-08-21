import { vi } from 'vitest'

// Mock the glyph utilities so building Scores in tests never loads the large
// Bravura font data (same mock the notation and web suites use).
vi.mock('@mushee/notation/components/glyphUtils', () => ({
    getGlyphWidth: () => 8,
    outlineToSvgPath: () => '',
}))
