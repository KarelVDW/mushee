import { ClefWidth } from '@mushee/notation/model/layout/ClefWidth'
import type { ClefType } from '@mushee/notation/model/types'
import { describe, expect, it } from 'vitest'

describe('ClefWidth', () => {
    it('paddingLeft and paddingRight are constants (4px each)', () => {
        const w = new ClefWidth('treble')
        expect(w.paddingLeft).toBe(4)
        expect(w.paddingRight).toBe(4)
    })

    it('total = paddingLeft + content + paddingRight', () => {
        const w = new ClefWidth('treble')
        expect(w.total).toBe(w.paddingLeft + w.content + w.paddingRight)
    })

    it('content is positive (clef has visible width)', () => {
        const w = new ClefWidth('treble')
        expect(w.content).toBeGreaterThan(0)
    })

    it('computes a positive width for bass, alto, and tenor clefs', () => {
        for (const type of ['bass', 'alto', 'tenor'] as ClefType[]) {
            expect(new ClefWidth(type).content).toBeGreaterThan(0)
        }
    })

    it('carries the glyph it measured, by clef sign', () => {
        expect(new ClefWidth('treble8vb').glyphName).toBe('gClef')
        expect(new ClefWidth('bass').glyphName).toBe('fClef')
        expect(new ClefWidth('tenor').glyphName).toBe('cClef')
    })

    it('of(type) shares one instance per clef type', () => {
        expect(ClefWidth.of('alto')).toBe(ClefWidth.of('alto'))
        expect(ClefWidth.of('alto')).not.toBe(ClefWidth.of('bass'))
        expect(ClefWidth.of('alto').total).toBe(new ClefWidth('alto').total)
    })
})
