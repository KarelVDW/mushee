// Clef vocabulary. A leaf module (it imports only another leaf): the clef tables are read at
// module init by ClefLayout and the codecs, and Clef.ts sits in an import cycle with its
// layout, so the tables must never live in a module inside that cycle.

import { LINES_PER_OCTAVE } from './staffLines'
import type { ClefType } from './types'

export type ClefSign = 'G' | 'F' | 'C'

/**
 * Every clef is defined by its sign (glyph), the staff line it sits on (MusicXML
 * convention: 1 = bottom line … 5 = top line), and an octave transposition shown
 * as an 8/15 marker. Glyph, anchor line, and pitch offset are all derived from this.
 */
export interface ClefDef {
    sign: ClefSign
    line: number
    octaveChange: number // +1 = 8va, -1 = 8vb, +2 = 15ma, -2 = 15mb
    label: string
}

export const CLEF_DEFS: Record<ClefType, ClefDef> = {
    treble: { sign: 'G', line: 2, octaveChange: 0, label: 'Treble' },
    treble8va: { sign: 'G', line: 2, octaveChange: 1, label: 'Treble 8va' },
    treble8vb: { sign: 'G', line: 2, octaveChange: -1, label: 'Treble 8vb' },
    treble15ma: { sign: 'G', line: 2, octaveChange: 2, label: 'Treble 15ma' },
    treble15mb: { sign: 'G', line: 2, octaveChange: -2, label: 'Treble 15mb' },
    soprano: { sign: 'C', line: 1, octaveChange: 0, label: 'Soprano' },
    mezzoSoprano: { sign: 'C', line: 2, octaveChange: 0, label: 'Mezzo-soprano' },
    alto: { sign: 'C', line: 3, octaveChange: 0, label: 'Alto' },
    tenor: { sign: 'C', line: 4, octaveChange: 0, label: 'Tenor' },
    baritoneC: { sign: 'C', line: 5, octaveChange: 0, label: 'Baritone (C clef)' },
    baritoneF: { sign: 'F', line: 3, octaveChange: 0, label: 'Baritone (F clef)' },
    bass: { sign: 'F', line: 4, octaveChange: 0, label: 'Bass' },
    bass8va: { sign: 'F', line: 4, octaveChange: 1, label: 'Bass 8va' },
    bass8vb: { sign: 'F', line: 4, octaveChange: -1, label: 'Bass 8vb' },
    bass15ma: { sign: 'F', line: 4, octaveChange: 2, label: 'Bass 15ma' },
    bass15mb: { sign: 'F', line: 4, octaveChange: -2, label: 'Bass 15mb' },
    subBass: { sign: 'F', line: 5, octaveChange: 0, label: 'Sub-bass' },
}

// Treble-formula staff line of each clef's reference pitch: G clef → G4, F clef → F3, C clef → C4.
const CLEF_REF_LINE: Record<ClefSign, number> = { G: 2, F: -2, C: 0 }

/**
 * Half-line shift applied to a pitch's treble-relative staff line for each clef
 * (a pitch sits higher on the staff in lower clefs, and octave clefs shift it by
 * whole octaves). Derived: (line − reference line) − octaveChange × 3.5.
 */
export const CLEF_LINE_OFFSET = Object.fromEntries(
    Object.entries(CLEF_DEFS).map(([type, def]) => [type, def.line - CLEF_REF_LINE[def.sign] - def.octaveChange * LINES_PER_OCTAVE]),
) as Record<ClefType, number>
