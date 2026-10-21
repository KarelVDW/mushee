// Test double for src/engraving/Bravura.ts, shared by the notation, web and playback
// suites (each setup file does `vi.mock(<Bravura module>, () => import(<this module>))`).
// It keeps the large font data out of tests and gives widths a deterministic table, so
// width and layout assertions hold in every suite. Deliberately import-free and outside
// the testing barrel: the barrel loads model classes, which load the mocked module.

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
    timeSig0: 7,
    timeSig1: 5,
    timeSig2: 7,
    timeSig3: 7,
    timeSig4: 7,
    timeSig5: 7,
    timeSig6: 7,
    timeSig7: 7,
    timeSig8: 7,
    timeSig9: 7,
}

export const Bravura = {
    /** The table width, whatever the scale. */
    width: (name: string): number => widths[name] ?? 8,
    svgPath: (): string => '',
}
