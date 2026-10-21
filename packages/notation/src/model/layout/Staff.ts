import { NUM_STAFF_LINES, SPACE_ABOVE_STAFF, STAVE_LINE_DISTANCE } from '../../engraving/constants'
import { STAFF_TOP_LINE } from '../staffLines'

/**
 * The staff's vertical coordinate system, in a row's local pixels (y grows downward; the
 * top staff line sits below SPACE_ABOVE_STAFF lines of headroom). Two line units meet here:
 * note lines — Pitch.line, C4 = 0, growing upward (see staffLines.ts) — and staff line
 * indices, 0 = top line … NUM_STAFF_LINES − 1 = bottom line.
 */
export class Staff {
    /** y of the top staff line. */
    static readonly TOP_Y = SPACE_ABOVE_STAFF * STAVE_LINE_DISTANCE
    /** Distance from the top staff line to the bottom one. */
    static readonly HEIGHT = (NUM_STAFF_LINES - 1) * STAVE_LINE_DISTANCE
    /** y of the middle staff line. */
    static readonly MIDDLE_Y = Staff.TOP_Y + Staff.HEIGHT / 2

    /** y of a note line: higher lines sit higher on screen (smaller y). */
    static yForNoteLine(line: number): number {
        return Staff.TOP_Y + STAFF_TOP_LINE * STAVE_LINE_DISTANCE - line * STAVE_LINE_DISTANCE
    }

    /** y of a staff line by index (0 = top line). */
    static yForStaffLine(index: number): number {
        return Staff.TOP_Y + index * STAVE_LINE_DISTANCE
    }

    /** The note line at `y`, snapped to the nearest half-line — the inverse of yForNoteLine. */
    static noteLineForY(y: number): number {
        const raw = SPACE_ABOVE_STAFF + STAFF_TOP_LINE - y / STAVE_LINE_DISTANCE
        return Math.round(raw * 2) / 2
    }
}
