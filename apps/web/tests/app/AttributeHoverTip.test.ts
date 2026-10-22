import type { AttributeClickEvent } from '@mushee/notation/components'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { AttributeHoverTip } from '@/app/scores/[id]/ScoreAttributePopover'
import { TOOLTIP_HOVER_DELAY_MS } from '@/components/ui/Tooltip'

// React's act() refuses to run outside a test-aware environment.
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const keyGlyph: AttributeClickEvent = { kind: 'key', fifths: 2, measureIndex: 0, x: 120, y: 40, staffBottom: 80 }
const tempoMark: AttributeClickEvent = { kind: 'tempo', beatPosition: 0, bpm: 100, measureIndex: 0, x: 60, y: 10, staffBottom: 80 }

describe('AttributeHoverTip', () => {
    let host: HTMLElement
    let root: Root

    const render = (event: AttributeClickEvent | null) => act(() => root.render(createElement(AttributeHoverTip, { event })))
    const advance = (ms: number) =>
        act(() => {
            vi.advanceTimersByTime(ms)
        })

    beforeEach(() => {
        vi.useFakeTimers()
        host = document.createElement('div')
        document.body.append(host)
        root = createRoot(host)
    })

    afterEach(() => {
        act(() => root.unmount())
        host.remove()
        vi.useRealTimers()
    })

    it('names what a click does after the shared hover delay, above the glyph', () => {
        render(keyGlyph)
        advance(TOOLTIP_HOVER_DELAY_MS - 1)
        expect(host.textContent).toBe('')
        advance(1)
        expect(host.textContent).toBe('Change key')
        const tip = host.firstElementChild as HTMLElement
        expect(tip.getAttribute('aria-hidden')).toBe('true')
        expect(tip.style.left).toBe('120px')
        expect(tip.style.top).toBe('32px')
    })

    it('is drawn in the shared tooltip card, anchored above the glyph', () => {
        render(keyGlyph)
        advance(TOOLTIP_HOVER_DELAY_MS)
        const tip = host.firstElementChild as HTMLElement
        expect(tip.className).toContain('tooltip-enter absolute z-(--z-popover) -translate-x-1/2 -translate-y-full')
        expect(tip.className).toContain('rounded-md bg-surface-container-lowest editorial-shadow')
        expect(tip.querySelector('.font-label.font-semibold')?.textContent).toBe('Change key')
    })

    it('restarts the delay for the next glyph, and goes at once when the pointer leaves', () => {
        render(keyGlyph)
        advance(TOOLTIP_HOVER_DELAY_MS)
        render(tempoMark)
        // Still the old label until the new delay runs out — no flicker of an empty card.
        expect(host.textContent).toBe('Change key')
        advance(TOOLTIP_HOVER_DELAY_MS)
        expect(host.textContent).toBe('Change tempo')
        render(null)
        expect(host.textContent).toBe('')
    })

    it('never shows when the pointer leaves before the delay (or a popover opens over it)', () => {
        render(keyGlyph)
        advance(TOOLTIP_HOVER_DELAY_MS / 2)
        // The editor passes null while a popover is open, hiding the label behind it.
        render(null)
        advance(TOOLTIP_HOVER_DELAY_MS)
        expect(host.textContent).toBe('')
    })
})
