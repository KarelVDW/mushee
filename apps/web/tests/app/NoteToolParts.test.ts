import { Duration } from '@mushee/notation/model'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

import {
    DURATION_TYPES,
    DurationIcon,
    DurationIconLayout,
    ICON_FLAG_SCALE,
    ICON_HEAD_HALF,
    ICON_NOTE_Y,
    ICON_STEM_HEIGHT,
    ICON_VIEW_HEIGHT,
} from '@/app/scores/[id]/NoteToolParts'

describe('DurationIcon', () => {
    it('leaves room under the notehead: no value is sliced flat at the bottom', () => {
        expect(ICON_HEAD_HALF).toBeCloseTo(5.05, 2)
        for (const type of DURATION_TYPES) {
            const layout = new DurationIconLayout(type)
            expect(ICON_NOTE_Y + ICON_HEAD_HALF, type).toBeLessThanOrEqual(ICON_VIEW_HEIGHT)
            // Centred on its ink, the drawing stays inside the view on both edges.
            expect(layout.inkTop + layout.offsetY, type).toBeGreaterThanOrEqual(0)
            expect(layout.inkBottom + layout.offsetY, type).toBeLessThanOrEqual(ICON_VIEW_HEIGHT)
        }
    })

    it('centres each value on its ink: the whole note lifts to the middle, the stemmed ones barely move', () => {
        for (const type of DURATION_TYPES) {
            const layout = new DurationIconLayout(type)
            const middle = (layout.inkTop + layout.inkBottom) / 2 + layout.offsetY
            expect(middle, type).toBeCloseTo(ICON_VIEW_HEIGHT / 2, 6)
        }
        expect(new DurationIconLayout('w').offsetY).toBeCloseTo(-10, 6)
        expect(Math.abs(new DurationIconLayout('q').offsetY)).toBeLessThan(2)
    })

    it("ends the eighth's and sixteenth's flag beside the head's upper half, never hanging past it", async () => {
        // The suite mocks the font with outline-free metrics; the flag's depth needs the real outline.
        const { Bravura } = await vi.importActual<typeof import('@mushee/notation/engraving/Bravura')>('@mushee/notation/engraving/Bravura')
        for (const type of ['8', '16'] as const) {
            const flag = new Duration({ type }).flagGlyph('up')
            if (!flag) throw new Error(`${type} has no flag`)
            // The path's coordinates are x y pairs, y pointing down from the stem tip.
            const ys = (Bravura.svgPath(flag, ICON_FLAG_SCALE).match(/-?\d+(?:\.\d+)?(?:e-?\d+)?/g) ?? [])
                .map(Number)
                .filter((_, i) => i % 2 === 1)
            expect(ys.length, type).toBeGreaterThan(0)
            const tail = ICON_NOTE_Y - ICON_STEM_HEIGHT + Math.max(...ys)
            expect(tail, type).toBeGreaterThan(ICON_NOTE_Y - ICON_HEAD_HALF - 4)
            expect(tail, type).toBeLessThan(ICON_NOTE_Y)
        }
    })

    it('draws in the text colour at the 28px-per-30-units scale, a dot widening only the dotted face', () => {
        const markup = renderToStaticMarkup(createElement(DurationIcon, { dur: 'q' }))
        expect(markup).toContain(`viewBox="0 0 ${new DurationIconLayout('q').viewWidth} ${ICON_VIEW_HEIGHT}"`)
        expect(markup).toContain(`height="${(ICON_VIEW_HEIGHT * 28) / 30}"`)
        expect(markup).toContain('overflow="visible"')
        // One ink, the text colour's: no hard-coded fill or stroke (the suite's font double draws no outlines).
        expect(markup).not.toMatch(/(?:fill|stroke)="#/)
        expect(markup).toContain('stroke="currentColor"')
        const dotted = renderToStaticMarkup(createElement(DurationIcon, { dur: 'q', dotted: true }))
        expect(dotted).toMatch(/<circle[^>]*fill="currentColor"/)
        expect(new DurationIconLayout('q', true).viewWidth).toBe(new DurationIconLayout('q').viewWidth + 6)
    })
})
