import type { ClefSign, ClefType } from './types'

/**
 * Canvas ink — the sanctuary charcoal from DESIGN.md. Notation is drawn in this, never pure
 * black. Kept as a literal (not a CSS var) so exported SVG/PDF snapshots stay correct
 * outside the app's stylesheet.
 */
export const NOTATION_INK = '#2d2f2f'

/**
 * Interaction overlays inside the canvas (selection, input cursor, playback cursor, live
 * recording waveform) share this one blue — deliberately neither brand accent, which are
 * banned inside the editor. Overlay elements carry `data-export-exclude`, so exports never
 * contain it.
 */
export const INTERACTION_BLUE = '#1e90ff'
export const INTERACTION_BLUE_BAND = 'rgba(30, 144, 255, 0.14)'

/** Pixels between adjacent staff lines */
export const STAVE_LINE_DISTANCE = 10

/** Staff lines of headroom above the top staff line */
export const SPACE_ABOVE_STAFF = 4

/** Number of horizontal staff lines */
export const NUM_STAFF_LINES = 5

/** Point size for notation glyphs (from VexFlow Tables.NOTATION_FONT_SCALE) */
export const NOTATION_FONT_SCALE = 39

/** Bravura font resolution (units per em) */
export const FONT_RESOLUTION = 1000

/** Scale factor to convert font units to SVG pixels */
export const GLYPH_SCALE = (NOTATION_FONT_SCALE * 72) / (FONT_RESOLUTION * 100) // ≈ 0.02808

/** Beam line thickness in pixels */
export const BEAM_WIDTH = 5

/** Maximum allowed beam slope */
export const BEAM_MAX_SLOPE = 0.25

/** Vertical stride between stacked beam levels (thickness * 1.5) */
export const BEAM_LEVEL_STRIDE = BEAM_WIDTH * 1.5

/** Length of partial (orphaned) secondary beams */
export const PARTIAL_BEAM_LENGTH = 10

/** Thin barline width in pixels */
export const BARLINE_THIN_WIDTH = 1

/** Thick barline width in pixels (end barline) */
export const BARLINE_THICK_WIDTH = 3

/** Gap between double/end barline strokes */
export const BARLINE_GAP = 3

/** Tuplet bracket vertical tick height in pixels */
export const TUPLET_BRACKET_HEIGHT = 10

/** Horizontal gap between bracket lines and the number */
export const TUPLET_NUMBER_GAP = 5

/** Vertical offset from stem tips / noteheads to bracket */
export const TUPLET_OFFSET = 15

/** Scale for tuplet number glyphs (3/5 of normal notation scale) */
export const TUPLET_NUMBER_SCALE = GLYPH_SCALE * (3 / 5)

/** Y position of tempo markings within headroom above staff */
export const TEMPO_MARKING_Y = 15

/** Scale multiplier for flags on dotted notes (relative to GLYPH_SCALE) */
export const DOTTED_FLAG_SCALE = GLYPH_SCALE * 0.7

/** Augmentation dot radius in pixels */
export const DOT_RADIUS = 2

/** Vertical offset from notehead center to tie endpoint */
export const TIE_Y_SHIFT = 7

export const SCORE_WIDTH = 1000
export const ROW_GAP = 16
export const ROW_HEIGHT = 160
export const MAX_MEASURES_PER_ROW = 4

export const MEASURE_BUTTON_SPACING = 30
export const MEASURE_BUTTON_SIZE = 18
export const MEASURE_BUTTON_GAP = 3

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

const CLEF_GLYPH: Record<ClefSign, string> = { G: 'gClef', F: 'fClef', C: 'cClef' }
// Treble-formula staff line of each clef's reference pitch: G clef → G4, F clef → F3, C clef → C4.
const CLEF_REF_LINE: Record<ClefSign, number> = { G: 2, F: -2, C: 0 }
// One octave = 7 diatonic steps = 3.5 line units.
const OCTAVE_IN_LINES = 3.5

/** Clef glyph name and the staff-line index (0 = top line) the glyph anchors on. */
export const CLEF_CONFIG = Object.fromEntries(
    Object.entries(CLEF_DEFS).map(([type, def]) => [type, { glyphName: CLEF_GLYPH[def.sign], lineIndex: 5 - def.line }]),
) as Record<ClefType, { glyphName: string; lineIndex: number }>

/**
 * Half-line shift applied to a pitch's treble-relative staff line for each clef
 * (a pitch sits higher on the staff in lower clefs, and octave clefs shift it by
 * whole octaves). Derived: (line − reference line) − octaveChange × 3.5.
 */
export const CLEF_LINE_OFFSET = Object.fromEntries(
    Object.entries(CLEF_DEFS).map(([type, def]) => [type, def.line - CLEF_REF_LINE[def.sign] - def.octaveChange * OCTAVE_IN_LINES]),
) as Record<ClefType, number>

/** The octave marker ("8" or "15", above or below) shown on a clef, if it transposes. */
export function clefOctaveMarker(type: ClefType): { text: string; above: boolean } | undefined {
    const oc = CLEF_DEFS[type].octaveChange
    if (oc === 0) return undefined
    return { text: Math.abs(oc) === 2 ? '15' : '8', above: oc > 0 }
}
