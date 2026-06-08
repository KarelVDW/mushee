import { clef } from '@test/helpers'
import { describe, expect, it } from 'vitest'

import type { ClefType } from '@/components/notation/types'
import { ClefWidth } from '@/model/width/ClefWidth'

describe('ClefWidth', () => {
    it('paddingLeft and paddingRight are constants (4px each)', () => {
        const w = new ClefWidth(clef('treble'))
        expect(w.paddingLeft).toBe(4)
        expect(w.paddingRight).toBe(4)
    })

    it('total = paddingLeft + content + paddingRight', () => {
        const w = new ClefWidth(clef('treble'))
        expect(w.total).toBe(w.paddingLeft + w.content + w.paddingRight)
    })

    it('content is positive (clef has visible width)', () => {
        const w = new ClefWidth(clef('treble'))
        expect(w.content).toBeGreaterThan(0)
    })

    it('computes a positive width for bass, alto, and tenor clefs', () => {
        for (const type of ['bass', 'alto', 'tenor'] as ClefType[]) {
            expect(new ClefWidth(clef(type)).content).toBeGreaterThan(0)
        }
    })

    it('throws on an unconfigured clef type', () => {
        expect(() => new ClefWidth(clef('percussion' as ClefType))).toThrow('Unknown clef type: percussion')
    })
})
