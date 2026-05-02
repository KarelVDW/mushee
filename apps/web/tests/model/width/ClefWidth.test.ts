import { describe, expect, it } from 'vitest'

import { Clef } from '@/model/Clef'
import { ClefWidth } from '@/model/width/ClefWidth'

describe('ClefWidth', () => {
    it('paddingLeft and paddingRight are constants (4px each)', () => {
        const w = new ClefWidth(new Clef('treble'))
        expect(w.paddingLeft).toBe(4)
        expect(w.paddingRight).toBe(4)
    })

    it('total = paddingLeft + content + paddingRight', () => {
        const w = new ClefWidth(new Clef('treble'))
        expect(w.total).toBe(w.paddingLeft + w.content + w.paddingRight)
    })

    it('content is positive (clef has visible width)', () => {
        const w = new ClefWidth(new Clef('treble'))
        expect(w.content).toBeGreaterThan(0)
    })

    it('throws on unknown clef type', () => {
        expect(() => new ClefWidth(new Clef('bass'))).toThrow('Unknown clef type: bass')
    })
})
