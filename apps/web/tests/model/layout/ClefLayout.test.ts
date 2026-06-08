import { clef } from '@test/helpers'
import { describe, expect, it } from 'vitest'

import type { ClefType } from '@/components/notation/types'

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
})
