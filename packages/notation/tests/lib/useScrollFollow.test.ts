import { cursorRowY, followScrollBehavior, scrollPaddingOf } from '@mushee/notation/lib/useScrollFollow'
import { afterEach, describe, expect, it, vi } from 'vitest'

/** Stub matchMedia so only the reduced-motion query matches, when `reduce` is set. */
function prefersReducedMotion(reduce: boolean) {
    vi.spyOn(window, 'matchMedia').mockImplementation(
        (query: string) => ({ matches: reduce && query === '(prefers-reduced-motion: reduce)', media: query }) as MediaQueryList,
    )
}

afterEach(() => {
    vi.restoreAllMocks()
})

describe('followScrollBehavior', () => {
    it('follows smoothly by default', () => {
        prefersReducedMotion(false)
        expect(followScrollBehavior()).toBe('smooth')
    })

    it('jumps instead under prefers-reduced-motion', () => {
        prefersReducedMotion(true)
        expect(followScrollBehavior()).toBe('auto')
    })
})

describe('scrollPaddingOf', () => {
    it('reads the scroller’s scroll padding as the covered edges, and none when unset', () => {
        const scroller = document.createElement('div')
        document.body.append(scroller)
        expect(scrollPaddingOf(scroller)).toEqual({ top: 0, bottom: 0 })
        scroller.style.scrollPaddingBottom = '112px'
        scroller.style.scrollPaddingTop = '8px'
        expect(scrollPaddingOf(scroller)).toEqual({ top: 8, bottom: 112 })
        scroller.remove()
    })
})

describe('cursorRowY', () => {
    const playhead = (attributes: Record<string, string>) => {
        const g = document.createElementNS('http://www.w3.org/2000/svg', 'g')
        for (const [name, value] of Object.entries(attributes)) g.setAttribute(name, value)
        return g
    }

    it('reads the row from the playhead’s translate(x, rowY)', () => {
        expect(cursorRowY(playhead({ display: '', transform: 'translate(123.25, 352)' }))).toBe(352)
        expect(cursorRowY(playhead({ transform: 'translate(0 176.5)' }))).toBe(176.5)
    })

    it('is null while the cursor is hidden or not yet placed', () => {
        expect(cursorRowY(playhead({ display: 'none', transform: 'translate(10, 176)' }))).toBeNull()
        expect(cursorRowY(playhead({ display: '' }))).toBeNull()
    })
})
