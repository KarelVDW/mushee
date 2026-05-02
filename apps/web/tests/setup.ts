import { vi } from 'vitest'

// Mock the glyph utilities to avoid loading the large Bravura font data in tests.
// Returns deterministic widths based on the glyph name so width classes have stable output.
vi.mock('@/components/notation/glyph-utils', () => {
    const widths: Record<string, number> = {
        gClef: 20,
        noteheadBlack: 10,
        noteheadHalf: 10,
        noteheadWhole: 14,
        restWhole: 12,
        restHalf: 12,
        restQuarter: 9,
        rest8th: 8,
        rest16th: 8,
        flag8thUp: 6,
        flag8thDown: 6,
        flag16thUp: 6,
        flag16thDown: 6,
        accidentalSharp: 8,
        accidentalFlat: 7,
        accidentalDoubleSharp: 10,
        accidentalDoubleFlat: 12,
        accidentalNatural: 7,
        // timeSig digits
        timeSig0: 7, timeSig1: 5, timeSig2: 7, timeSig3: 7,
        timeSig4: 7, timeSig5: 7, timeSig6: 7, timeSig7: 7,
        timeSig8: 7, timeSig9: 7,
    }
    return {
        getGlyphWidth: (name: string) => widths[name] ?? 8,
        outlineToSvgPath: () => '',
    }
})
