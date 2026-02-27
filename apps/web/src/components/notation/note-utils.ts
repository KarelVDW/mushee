import { SPACE_ABOVE_STAFF, STAVE_LINE_DISTANCE } from './constants'
import type { Duration } from './types'

const NOTE_INDEX: Record<string, number> = {
    C: 0,
    D: 1,
    E: 2,
    F: 3,
    G: 4,
    A: 5,
    B: 6,
}

/**
 * Parse a key string like "C#/5" or "C#/5/r" into its components.
 * The optional "/r" suffix marks the note as a rest.
 */
export function parseKey(key: string): {
    noteName: string
    accidental: string | undefined
    octave: number
    isRest: boolean
} {
    const parts = key.split('/')
    const pitch = parts[0]
    const noteName = pitch[0].toUpperCase()
    const accidental = pitch.length > 1 ? pitch.slice(1) : undefined
    const octave = parseInt(parts[1], 10)
    const isRest = parts[2] === 'r'
    return { noteName, accidental, octave, isRest }
}

/**
 * Convert a pitch to a "note line" value used in coordinate calculations.
 * In treble clef:
 *   C4 = 0, D4 = 0.5, E4 = 1, F4 = 1.5, G4 = 2, A4 = 2.5, B4 = 3
 *   C5 = 3.5, D5 = 4, ...
 */
export function pitchToLine(key: string, clef: string = 'treble'): number {
    const { noteName, octave } = parseKey(key)
    const noteIndex = NOTE_INDEX[noteName]
    const baseIndex = octave * 7 - 28
    const line = (baseIndex + noteIndex) / 2
    // Treble clef shift is 0; bass clef would be -6
    if (clef === 'bass') return line - 6
    return line
}

/**
 * Convert a note line value to a Y coordinate on the stave.
 * Higher line = higher Y (lower on screen), since line 0 (C4) is below the staff.
 * The stave top (line 5, F5 area) has the smallest Y.
 *
 * @param line - The note line value from pitchToLine()
 * @param staveY - The Y coordinate of the stave top (before headroom)
 */
export function getYForNote(line: number, staveY: number): number {
    const headroom = SPACE_ABOVE_STAFF * STAVE_LINE_DISTANCE
    return staveY + headroom + 5 * STAVE_LINE_DISTANCE - line * STAVE_LINE_DISTANCE
}

/**
 * Convert a staff line index (0-4, top to bottom) to a Y coordinate.
 */
export function getYForLine(lineIndex: number, staveY: number): number {
    const headroom = SPACE_ABOVE_STAFF * STAVE_LINE_DISTANCE
    return staveY + headroom + lineIndex * STAVE_LINE_DISTANCE
}

/**
 * Get the rest glyph name for a given duration.
 */
export function restGlyphForDuration(duration: Duration): string {
    switch (duration) {
        case 'w':
            return 'restWhole'
        case 'h':
            return 'restHalf'
        case 'q':
            return 'restQuarter'
        case '8':
            return 'rest8th'
        case '16':
            return 'rest16th'
    }
}

/** Default note line for rest positioning (whole rest on line 4, others on line 3). */
export function restLine(duration: Duration): number {
    return duration === 'w' ? 4 : 3
}

/**
 * Get the notehead glyph name for a given duration.
 */
export function noteheadForDuration(duration: Duration): string {
    switch (duration) {
        case 'w':
            return 'noteheadWhole'
        case 'h':
            return 'noteheadHalf'
        default:
            return 'noteheadBlack'
    }
}

/**
 * Get the accidental glyph name for an accidental string.
 */
export function accidentalGlyphName(acc: string): string | undefined {
    switch (acc) {
        case '#':
            return 'accidentalSharp'
        case 'b':
            return 'accidentalFlat'
        case '##':
            return 'accidentalDoubleSharp'
        case 'bb':
            return 'accidentalDoubleFlat'
        case 'n':
            return 'accidentalNatural'
        default:
            return undefined
    }
}

/**
 * Get the flag glyph name for a duration and stem direction.
 * Returns undefined for durations that don't have flags (whole, half, quarter).
 */
export function flagGlyphName(duration: Duration, stemDirection: 'up' | 'down'): string | undefined {
    switch (duration) {
        case '8':
            return stemDirection === 'up' ? 'flag8thUp' : 'flag8thDown'
        case '16':
            return stemDirection === 'up' ? 'flag16thUp' : 'flag16thDown'
        default:
            return undefined
    }
}

/**
 * Get the number of beams for a duration.
 * 8th = 1, 16th = 2. Returns 0 for unbeamable durations.
 */
export function beamCount(duration: Duration): number {
    switch (duration) {
        case '8':
            return 1
        case '16':
            return 2
        default:
            return 0
    }
}

/**
 * Whether a duration is beamable (shorter than a quarter note).
 */
export function isBeamable(duration: Duration): boolean {
    return beamCount(duration) > 0
}

/**
 * Apply dot multiplier to a beat count.
 * 1 dot = 1.5x, 2 dots = 1.75x, formula: beats * (2 - 1/(2^dots))
 */
export function applyDots(beats: number, dots: number): number {
    if (dots <= 0) return beats
    return beats * (2 - 1 / Math.pow(2, dots))
}

/**
 * Convert a duration to the number of quarter-note beats.
 */
export function durationToBeats(duration: Duration): number {
    switch (duration) {
        case 'w':
            return 4
        case 'h':
            return 2
        case 'q':
            return 1
        case '8':
            return 0.5
        case '16':
            return 0.25
    }
}

const INDEX_TO_NOTE = ['C', 'D', 'E', 'F', 'G', 'A', 'B']

/**
 * Convert a Y pixel coordinate to a note line, snapped to the nearest half-line.
 * Reverse of getYForNote (with staveY = 0).
 */
export function yToLine(y: number): number {
    const raw = SPACE_ABOVE_STAFF + 5 - y / STAVE_LINE_DISTANCE
    return Math.round(raw * 2) / 2
}

/**
 * Convert a note line value back to a key string like "C/5".
 * Reverse of pitchToLine (treble clef).
 */
export function lineToKey(line: number, clef: string = 'treble'): string {
    // Undo clef shift
    const adjustedLine = clef === 'bass' ? line + 6 : line
    // pitchToLine: line = (octave * 7 - 28 + noteIndex) / 2
    // So: octave * 7 + noteIndex = line * 2 + 28
    const raw = adjustedLine * 2 + 28
    const octave = Math.floor(raw / 7)
    const noteIndex = Math.round(raw - octave * 7)
    const noteName = INDEX_TO_NOTE[noteIndex] ?? 'C'
    return `${noteName}/${octave}`
}

/**
 * Determine which ledger lines are needed for a note at a given line.
 * Returns an array of staff-line Y values where ledger lines should be drawn.
 * Line 0 = top staff line, line 4 = bottom staff line.
 * Notes above the staff (line < 0) or below (line > 4) need ledger lines.
 */
export function getLedgerLinePositions(noteLine: number, staveY: number): number[] {
    const positions: number[] = []

    // Notes below the staff (noteLine < 1, i.e., below line index 4)
    // noteLine 0 = C4 in treble = one ledger line below
    // The staff bottom is at note-line 1 (E4), which is staff line index 4
    if (noteLine < 1) {
        // Need ledger lines from note-line 0 down to the note
        // Each integer note-line that is <= 0 corresponds to a ledger line
        for (let l = 0; l >= noteLine; l--) {
            if (l % 1 === 0) {
                // Only draw ledger lines at integer positions (on the line, not in space)
                positions.push(getYForNote(l, staveY))
            }
        }
    }

    // Notes above the staff (noteLine > 5, i.e., above line index 0)
    // The staff top is at note-line 5 (F5), which is staff line index 0
    if (noteLine > 5) {
        for (let l = 6; l <= noteLine; l++) {
            if (l % 1 === 0) {
                positions.push(getYForNote(l, staveY))
            }
        }
    }

    return positions
}
