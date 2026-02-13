/** Pixels between adjacent staff lines */
export const STAVE_LINE_DISTANCE = 10;

/** Staff lines of headroom above the top staff line */
export const SPACE_ABOVE_STAFF = 4;

/** Number of horizontal staff lines */
export const NUM_STAFF_LINES = 5;

/** Point size for notation glyphs (from VexFlow Tables.NOTATION_FONT_SCALE) */
export const NOTATION_FONT_SCALE = 39;

/** Bravura font resolution (units per em) */
export const FONT_RESOLUTION = 1000;

/** Scale factor to convert font units to SVG pixels */
export const GLYPH_SCALE =
  (NOTATION_FONT_SCALE * 72) / (FONT_RESOLUTION * 100); // ≈ 0.02808

/** Default stem height in pixels */
export const STEM_HEIGHT = 35;

/** Default stem line width in pixels */
export const STEM_WIDTH = 1.5;

/** Ledger line overshoot on each side of the notehead (pixels) */
export const LEDGER_LINE_EXTENSION = 4;

/** Padding between stave left edge and first modifier (clef) */
export const STAVE_LEFT_PADDING = 10;

/** Padding between clef and time signature */
export const CLEF_TIME_SIG_PADDING = 8;

/** Padding between time signature and first note */
export const TIME_SIG_NOTE_PADDING = 15;

/** Padding after last note before stave right edge */
export const STAVE_RIGHT_PADDING = 10;

/** Beam line thickness in pixels */
export const BEAM_WIDTH = 5;

/** Maximum allowed beam slope */
export const BEAM_MAX_SLOPE = 0.25;

/** Vertical stride between stacked beam levels (thickness * 1.5) */
export const BEAM_LEVEL_STRIDE = BEAM_WIDTH * 1.5;

/** Length of partial (orphaned) secondary beams */
export const PARTIAL_BEAM_LENGTH = 10;
