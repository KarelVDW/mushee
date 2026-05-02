import { describe, expect, it } from 'vitest'

import { Clef } from '@/model/Clef'

describe('ClefLayout', () => {
    it('produces a glyphName and y for the treble clef', () => {
        const c = new Clef('treble')
        const layout = c.layout
        expect(layout.glyphName).toBe('gClef')
        expect(typeof layout.y).toBe('number')
    })

    it('throws for an unknown clef type', () => {
        const c = new Clef('bass')
        expect(() => c.layout).toThrow()
    })

    it('x equals the clef width paddingLeft', () => {
        const c = new Clef('treble')
        expect(c.layout.x).toBe(c.width.paddingLeft)
    })

    it('cached layout returns the same instance', () => {
        const c = new Clef('treble')
        expect(c.layout).toBe(c.layout)
    })
})
