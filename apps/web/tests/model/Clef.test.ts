import { describe, expect, it } from 'vitest'

import { Clef } from '@/model/Clef'

describe('Clef', () => {
    it('stores type', () => {
        const c = new Clef('treble')
        expect(c.type).toBe('treble')
    })

    it('measure getter throws when measure is unset', () => {
        const c = new Clef('treble')
        expect(() => c.measure).toThrow('Clef is not assigned to measure')
    })

    it('lazily creates a single ClefWidth instance', () => {
        const c = new Clef('treble')
        expect(c.width).toBe(c.width)
    })

    it('throws if width is requested for an unknown clef type', () => {
        // ClefType is 'treble' | 'bass' but CLEF_CONFIG only has 'treble'
        const c = new Clef('bass')
        expect(() => c.width).toThrow('Unknown clef type: bass')
    })

    it('invalidateLayout clears cached layout', () => {
        const c = new Clef('treble')
        const l1 = c.layout
        c.invalidateLayout()
        const l2 = c.layout
        expect(l1).not.toBe(l2)
    })
})
