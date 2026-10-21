// Where the staff sits in note-line units — the unit of Pitch.line: C4 = 0, one unit per
// staff line (two diatonic steps), measured in the treble frame (clefs add their offset).
// Import-free on purpose: Clef, the layout classes and the renderer constants all read
// these at module init, and a leaf module can never be caught in their import cycle.

/** The bottom staff line (E4 in treble). */
export const STAFF_BOTTOM_LINE = 1
/** The middle staff line (B4 in treble) — where stems flip direction. */
export const STAFF_MIDDLE_LINE = 3
/** The top staff line (F5 in treble). */
export const STAFF_TOP_LINE = 5
/** One octave — 7 diatonic steps — in note-line units. */
export const LINES_PER_OCTAVE = 3.5
