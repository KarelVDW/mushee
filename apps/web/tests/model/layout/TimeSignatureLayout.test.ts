import { describe, expect, it } from 'vitest'

import { TimeSignature } from '@/model/TimeSignature'

describe('TimeSignatureLayout', () => {
    it('builds top and bottom digit glyph rows', () => {
        const ts = new TimeSignature(4, 4)
        const layout = ts.layout
        expect(layout.topDigits.length).toBeGreaterThan(0)
        expect(layout.bottomDigits.length).toBeGreaterThan(0)
        for (const d of layout.topDigits) expect(d.glyphName).toMatch(/^timeSig\d$/)
    })

    it('multi-digit numerators (12/8) yield two top digits', () => {
        const ts = new TimeSignature(12, 8)
        expect(ts.layout.topDigits).toHaveLength(2)
        expect(ts.layout.bottomDigits).toHaveLength(1)
    })

    it('cached layout returns the same instance until invalidated', () => {
        const ts = new TimeSignature(4, 4)
        const a = ts.layout
        expect(ts.layout).toBe(a)
        ts.invalidateLayout()
        expect(ts.layout).not.toBe(a)
    })
})
