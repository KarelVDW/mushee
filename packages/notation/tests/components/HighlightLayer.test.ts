import { HighlightLayer } from '@mushee/notation/components/HighlightLayer'
import { makeScore } from '@mushee/notation/testing'
import type { ReactElement } from 'react'
import { describe, expect, it } from 'vitest'

/** The layer's <g>: its <style> tag's text and its band rects' props (it renders without hooks). */
function render(kind: 'pulse' | 'flash') {
    const layer = HighlightLayer({ score: makeScore(2), highlight: { kind, notes: 'all', id: 1 } }) as ReactElement<{
        children: [ReactElement<{ children: string }>, ReactElement<{ fillOpacity: number; style: { animation: string } }>[]]
    }>
    const [style, rects] = layer.props.children
    return { css: style.props.children, rects: rects.map((rect) => rect.props) }
}

describe('HighlightLayer under reduced motion', () => {
    it('stops its animations when the viewer asks for reduced motion', () => {
        for (const kind of ['pulse', 'flash'] as const) {
            expect(render(kind).css).toMatch(
                /@media \(prefers-reduced-motion: reduce\) \{ \[data-score-highlight\] rect \{ animation: none !important \} \}/,
            )
        }
    })

    it('rests at the pulse peak, so a band without its animation still shows', () => {
        for (const kind of ['pulse', 'flash'] as const) {
            const { rects } = render(kind)
            expect(rects.length).toBeGreaterThan(0)
            for (const rect of rects) expect(rect.fillOpacity).toBe(0.16)
        }
    })

    it('keeps the breathing pulse and the fading flash otherwise', () => {
        expect(render('pulse').rects[0].style.animation).toContain('solkey-score-pulse')
        expect(render('flash').rects[0].style.animation).toContain('solkey-score-flash')
    })
})
