import { getGlyphWidth, getYForLine } from '@mushee/notation/components'
import { NUM_STAFF_LINES } from '@mushee/notation/components/constants'
import type { ClefType } from '@mushee/notation/components/types'
import { clef } from '@mushee/notation/testing'
import { describe, expect, it } from 'vitest'

describe('ClefLayout', () => {
    it('produces a glyphName and y for the treble clef', () => {
        const layout = clef('treble').layout
        expect(layout.glyphName).toBe('gClef')
        expect(typeof layout.y).toBe('number')
    })

    it('maps bass to fClef and alto/tenor to cClef', () => {
        expect(clef('bass').layout.glyphName).toBe('fClef')
        expect(clef('alto').layout.glyphName).toBe('cClef')
        expect(clef('tenor').layout.glyphName).toBe('cClef')
    })

    it('throws for an unconfigured clef type', () => {
        expect(() => clef('percussion' as ClefType).layout).toThrow()
    })

    it('x equals the clef width paddingLeft', () => {
        const c = clef('treble')
        expect(c.layout.x).toBe(c.width.paddingLeft)
    })

    it('cached layout returns the same instance', () => {
        const c = clef('treble')
        expect(c.layout).toBe(c.layout)
    })

    it('a non-transposing clef has no octave marker', () => {
        expect(clef('treble').layout.octave).toBeUndefined()
    })

    it('an 8va clef draws an "8" marker above the staff', () => {
        const layout = clef('treble8va').layout
        const octave = layout.octave
        if (!octave) throw new Error('expected an octave marker')
        expect(octave.text).toBe('8')
        // Above the staff → marker y sits above the top staff line.
        expect(octave.y).toBe(getYForLine(0) - 6)
        // Horizontally centred over the glyph.
        const c = clef('treble8va')
        expect(octave.x).toBe(c.width.paddingLeft + getGlyphWidth('gClef') / 2)
    })

    it('an 8vb clef draws an "8" marker below the staff', () => {
        const layout = clef('bass8vb').layout
        const octave = layout.octave
        if (!octave) throw new Error('expected an octave marker')
        expect(octave.text).toBe('8')
        // Below the staff → marker y sits below the bottom staff line.
        expect(octave.y).toBe(getYForLine(NUM_STAFF_LINES - 1) + 13)
    })

    it('a 15ma clef draws a "15" marker above the staff', () => {
        const layout = clef('treble15ma').layout
        const octave = layout.octave
        if (!octave) throw new Error('expected an octave marker')
        expect(octave.text).toBe('15')
        expect(octave.y).toBe(getYForLine(0) - 6)
    })

    it('a 15mb clef draws a "15" marker below the staff', () => {
        const layout = clef('bass15mb').layout
        const octave = layout.octave
        if (!octave) throw new Error('expected an octave marker')
        expect(octave.text).toBe('15')
        expect(octave.y).toBe(getYForLine(NUM_STAFF_LINES - 1) + 13)
    })
})
