import { NUM_STAFF_LINES, SPACE_ABOVE_STAFF, STAVE_LINE_DISTANCE } from '@mushee/notation/engraving/constants'
import { Staff } from '@mushee/notation/model/layout/Staff'
import { Pitch } from '@mushee/notation/model/Pitch'
import { STAFF_BOTTOM_LINE, STAFF_MIDDLE_LINE, STAFF_TOP_LINE } from '@mushee/notation/model/staffLines'
import { describe, expect, it } from 'vitest'

describe('Staff', () => {
    it('places the top line below the headroom and spans the lines between top and bottom', () => {
        expect(Staff.TOP_Y).toBe(SPACE_ABOVE_STAFF * STAVE_LINE_DISTANCE)
        expect(Staff.HEIGHT).toBe((NUM_STAFF_LINES - 1) * STAVE_LINE_DISTANCE)
        expect(Staff.MIDDLE_Y).toBe(Staff.TOP_Y + Staff.HEIGHT / 2)
    })

    it('puts staff line indices from the top line down', () => {
        expect(Staff.yForStaffLine(0)).toBe(Staff.TOP_Y)
        expect(Staff.yForStaffLine(NUM_STAFF_LINES - 1)).toBe(Staff.TOP_Y + Staff.HEIGHT)
    })

    it('puts note lines on the staff lines they name, higher lines higher on screen', () => {
        expect(Staff.yForNoteLine(STAFF_TOP_LINE)).toBe(Staff.yForStaffLine(0))
        expect(Staff.yForNoteLine(STAFF_MIDDLE_LINE)).toBe(Staff.MIDDLE_Y)
        expect(Staff.yForNoteLine(STAFF_BOTTOM_LINE)).toBe(Staff.yForStaffLine(NUM_STAFF_LINES - 1))
        // C4 sits on the first ledger line below the treble staff.
        expect(Staff.yForNoteLine(new Pitch({ name: 'C', octave: 4 }).line)).toBe(Staff.TOP_Y + Staff.HEIGHT + STAVE_LINE_DISTANCE)
    })

    it('reads a y back as the nearest half note-line', () => {
        for (const line of [-2, -0.5, 0, 1, 2.5, 3, 5, 6.5]) expect(Staff.noteLineForY(Staff.yForNoteLine(line))).toBe(line)
        // A quarter line off snaps to the nearest half-line.
        expect(Staff.noteLineForY(Staff.yForNoteLine(3) - STAVE_LINE_DISTANCE * 0.2)).toBe(3)
        expect(Staff.noteLineForY(Staff.yForNoteLine(3) - STAVE_LINE_DISTANCE * 0.3)).toBe(3.5)
    })
})
