import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import {
    DURATION_TYPES,
    DurationIcon,
    DurationIconLayout,
    ICON_HEAD_HALF,
    ICON_NOTE_Y,
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
