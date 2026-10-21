import { Bravura } from '@mushee/notation/engraving/Bravura'
import { NUM_STAFF_LINES } from '@mushee/notation/engraving/constants'
import { ClefLayout } from '@mushee/notation/model/layout/ClefLayout'
import { ClefWidth } from '@mushee/notation/model/layout/ClefWidth'
import { Staff } from '@mushee/notation/model/layout/Staff'
import { clef } from '@mushee/notation/testing'
import { describe, expect, it } from 'vitest'

describe('ClefLayout', () => {
    it('produces a glyphName and y for the treble clef', () => {
        const layout = ClefLayout.of('treble')
        expect(layout.glyphName).toBe('gClef')
        // The G clef curls around the second line from the bottom.
        expect(layout.y).toBe(Staff.yForStaffLine(3))
    })

    it('maps bass to fClef and alto/tenor to cClef', () => {
        expect(ClefLayout.of('bass').glyphName).toBe('fClef')
        expect(ClefLayout.of('alto').glyphName).toBe('cClef')
        expect(ClefLayout.of('tenor').glyphName).toBe('cClef')
    })

    it('owns the shared width for its type, and x equals its paddingLeft', () => {
        const layout = ClefLayout.of('treble')
        expect(layout.width).toBe(ClefWidth.of('treble'))
        expect(layout.x).toBe(layout.width.paddingLeft)
    })

    it('of(type) shares one instance per clef type — what Clef.layout delegates to', () => {
        expect(ClefLayout.of('treble')).toBe(ClefLayout.of('treble'))
        expect(clef('treble').layout).toBe(ClefLayout.of('treble'))
        expect(ClefLayout.of('bass')).not.toBe(ClefLayout.of('treble'))
    })

    it('a non-transposing clef has no octave marker', () => {
        expect(ClefLayout.of('treble').octave).toBeUndefined()
    })

    it('an 8va clef draws an "8" marker above the staff', () => {
        const layout = ClefLayout.of('treble8va')
        const octave = layout.octave
        if (!octave) throw new Error('expected an octave marker')
        expect(octave.text).toBe('8')
        // Above the staff → marker y sits above the top staff line.
        expect(octave.y).toBe(Staff.yForStaffLine(0) - 6)
        // Horizontally centred over the glyph.
        expect(octave.x).toBe(layout.width.paddingLeft + Bravura.width('gClef') / 2)
    })

    it('an 8vb clef draws an "8" marker below the staff', () => {
        const octave = ClefLayout.of('bass8vb').octave
        if (!octave) throw new Error('expected an octave marker')
        expect(octave.text).toBe('8')
        // Below the staff → marker y sits below the bottom staff line.
        expect(octave.y).toBe(Staff.yForStaffLine(NUM_STAFF_LINES - 1) + 13)
    })

    it('a 15ma clef draws a "15" marker above the staff', () => {
        const octave = ClefLayout.of('treble15ma').octave
        if (!octave) throw new Error('expected an octave marker')
        expect(octave.text).toBe('15')
        expect(octave.y).toBe(Staff.yForStaffLine(0) - 6)
    })

    it('a 15mb clef draws a "15" marker below the staff', () => {
        const octave = ClefLayout.of('bass15mb').octave
        if (!octave) throw new Error('expected an octave marker')
        expect(octave.text).toBe('15')
        expect(octave.y).toBe(Staff.yForStaffLine(NUM_STAFF_LINES - 1) + 13)
    })
})
