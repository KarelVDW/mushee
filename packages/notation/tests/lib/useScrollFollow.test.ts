import { followScrollBehavior, scrollPaddingOf } from '@mushee/notation/lib/useScrollFollow'
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
