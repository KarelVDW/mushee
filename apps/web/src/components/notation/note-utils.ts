import { SPACE_ABOVE_STAFF, STAVE_LINE_DISTANCE } from './constants'

/**
 * Convert a note line value to a Y coordinate on the stave.
 * Higher line = higher Y (lower on screen), since line 0 (C4) is below the staff.
 * The stave top (line 5, F5 area) has the smallest Y.
 *
 * @param line - The note line value from Pitch.toLine()
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
 * Convert a Y pixel coordinate to a note line, snapped to the nearest half-line.
 * Reverse of getYForNote (with staveY = 0).
 */
export function yToLine(y: number): number {
    const raw = SPACE_ABOVE_STAFF + 5 - y / STAVE_LINE_DISTANCE
    return Math.round(raw * 2) / 2
}

/**
 * Convert an X pixel coordinate to a continuous beat value within a measure.
 * Simple linear mapping: position within measure → beat within total beats.
 * Inverse of the beat→x mapping produced during layout.
 */
export function xToBeat(x: number, measureX: number, measureWidth: number, totalBeats: number): number {
    const t = Math.max(0, Math.min(1, (x - measureX) / measureWidth))
    return t * totalBeats
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
