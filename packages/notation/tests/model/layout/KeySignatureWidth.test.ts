import { KeySignatureLayout } from '@mushee/notation/model/layout/KeySignatureLayout'
import { KeySignatureWidth } from '@mushee/notation/model/layout/KeySignatureWidth'
import { key } from '@mushee/notation/testing'
import { describe, expect, it } from 'vitest'

// Glyph widths come from the deterministic mock in tests/setup.ts:
//   accidentalSharp = 8, accidentalFlat = 7. The class adds a 2px gap after each.
const SHARP = 8
const FLAT = 7
const GAP = 2

/** The drawn accidentals of a standalone key of `fifths` (nothing precedes it, so no cancellation naturals). */
const drawnFor = (fifths: number) => KeySignatureLayout.drawnAccidentalsFor(key(fifths))

describe('KeySignatureWidth', () => {
    describe('C major (no accidentals)', () => {
        it('occupies no horizontal space at all', () => {
            const w = new KeySignatureWidth(drawnFor(0))
            expect(w.paddingLeft).toBe(0)
            expect(w.paddingRight).toBe(0)
            expect(w.content).toBe(0)
            expect(w.total).toBe(0)
        })
    })

    describe('keys with accidentals', () => {
        it('pads 4px left and 8px right', () => {
            const w = new KeySignatureWidth(drawnFor(1))
            expect(w.paddingLeft).toBe(4)
            expect(w.paddingRight).toBe(8)
        })

        it('carries the drawn accidentals it measured', () => {
            const drawn = drawnFor(2)
            expect(new KeySignatureWidth(drawn).drawnAccidentals).toBe(drawn)
        })

        it('content sums each sharp glyph plus the inter-accidental gap', () => {
            // G major: 1 sharp
            expect(new KeySignatureWidth(drawnFor(1)).content).toBe(SHARP + GAP)
            // D major: 2 sharps
            expect(new KeySignatureWidth(drawnFor(2)).content).toBe(2 * (SHARP + GAP))
            // C# major: 7 sharps
            expect(new KeySignatureWidth(drawnFor(7)).content).toBe(7 * (SHARP + GAP))
        })

        it('content sums each flat glyph plus the inter-accidental gap', () => {
            // F major: 1 flat
            expect(new KeySignatureWidth(drawnFor(-1)).content).toBe(FLAT + GAP)
            // Cb major: 7 flats
            expect(new KeySignatureWidth(drawnFor(-7)).content).toBe(7 * (FLAT + GAP))
        })

        it('total = paddingLeft + content + paddingRight', () => {
            const w = new KeySignatureWidth(drawnFor(3))
            expect(w.total).toBe(w.paddingLeft + w.content + w.paddingRight)
            expect(w.total).toBe(4 + 3 * (SHARP + GAP) + 8)
        })

        it('grows monotonically as more accidentals are added', () => {
            const widths = [1, 2, 3, 4].map((f) => new KeySignatureWidth(drawnFor(f)).content)
            for (let i = 1; i < widths.length; i++) {
                expect(widths[i]).toBeGreaterThan(widths[i - 1])
            }
        })
    })
})
