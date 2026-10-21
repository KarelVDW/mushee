import { TimeSignature } from '@mushee/notation/model/TimeSignature'
import { describe, expect, it } from 'vitest'

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

    it('spaces 12/8 by its real digit widths and centres the denominator under the numerator', () => {
        // Mock widths: timeSig1 = 5, timeSig2 = 7, timeSig8 = 7 → content = max(12, 7) = 12.
        const ts = new TimeSignature(12, 8)
        const [one, two] = ts.layout.topDigits
        const [eight] = ts.layout.bottomDigits
        expect(one.x).toBe(ts.width.paddingLeft)
        expect(two.x).toBe(one.x + 5) // after the "1", not at a fixed per-digit stride
        expect(eight.x + 7 / 2).toBe(one.x + 12 / 2) // bottom row centred under the top
        expect(one.y).toBeLessThan(eight.y)
    })

    it('caches the layout forever — TimeSignature is an immutable value object', () => {
        const ts = new TimeSignature(4, 4)
        const a = ts.layout
        expect(ts.layout).toBe(a)
        expect(ts.layout).toBe(a)
    })
})
