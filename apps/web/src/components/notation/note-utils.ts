import { SPACE_ABOVE_STAFF, STAVE_LINE_DISTANCE } from './constants'

/**
 * Convert a note line value to a Y coordinate on the stave.
 * Higher line = higher Y (lower on screen), since line 0 (C4) is below the staff.
 * The stave top (line 5, F5 area) has the smallest Y.
 *
 * @param line - The note line value from Pitch.toLine()
 */
export function getYForNote(line: number): number {
    const headroom = SPACE_ABOVE_STAFF * STAVE_LINE_DISTANCE
    return  headroom + 5 * STAVE_LINE_DISTANCE - line * STAVE_LINE_DISTANCE
}

/**
 * Convert a staff line index (0-4, top to bottom) to a Y coordinate.
 */
export function getYForLine(lineIndex: number): number {
    const headroom = SPACE_ABOVE_STAFF * STAVE_LINE_DISTANCE
    return  headroom + lineIndex * STAVE_LINE_DISTANCE
}

/**
 * Convert a Y pixel coordinate to a note line, snapped to the nearest half-line.
 * Reverse of getYForNote.
 */
export function getLineForY(y: number): number {
    const raw = SPACE_ABOVE_STAFF + 5 - y / STAVE_LINE_DISTANCE
    return Math.round(raw * 2) / 2
}
