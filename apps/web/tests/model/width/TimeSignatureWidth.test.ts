import { describe, expect, it } from 'vitest'

import { TimeSignature } from '@/model/TimeSignature'
import { TimeSignatureWidth } from '@/model/width/TimeSignatureWidth'

describe('TimeSignatureWidth', () => {
    it('paddings are constants (4 left, 15 right)', () => {
        const w = new TimeSignatureWidth(new TimeSignature(4, 4))
        expect(w.paddingLeft).toBe(4)
        expect(w.paddingRight).toBe(15)
    })

    it('total = paddingLeft + content + paddingRight', () => {
        const w = new TimeSignatureWidth(new TimeSignature(4, 4))
        expect(w.total).toBe(w.paddingLeft + w.content + w.paddingRight)
    })

    it('content is the wider of numerator vs denominator digit row', () => {
        const w = new TimeSignatureWidth(new TimeSignature(12, 8))
        // numerator "12" = 5 + 7 = 12 (per mock); denominator "8" = 7
        // so content should be max → 12
        expect(w.content).toBe(12)
    })

    it('content is positive for any valid signature', () => {
        expect(new TimeSignatureWidth(new TimeSignature(4, 4)).content).toBeGreaterThan(0)
        expect(new TimeSignatureWidth(new TimeSignature(3, 8)).content).toBeGreaterThan(0)
    })
})
