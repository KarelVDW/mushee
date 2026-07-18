import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { BrowserSupportBanner, meetsBrowserFloor } from '@/components/BrowserSupportBanner'

// React's act() refuses to run outside a test-aware environment.
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

/** Stub the two feature probes the floor check reads. */
function stubFloor({ colorMix, propertyRule }: { colorMix: boolean; propertyRule: boolean }) {
    vi.stubGlobal('CSS', { supports: vi.fn(() => colorMix) })
    vi.stubGlobal('CSSPropertyRule', propertyRule ? class {} : undefined)
}

describe('meetsBrowserFloor', () => {
    afterEach(() => vi.unstubAllGlobals())

    it('passes when color-mix and @property are both available', () => {
        stubFloor({ colorMix: true, propertyRule: true })
        expect(meetsBrowserFloor()).toBe(true)
    })

    it('fails when color-mix is unsupported (pre-Tailwind-v4-floor browser)', () => {
        stubFloor({ colorMix: false, propertyRule: true })
        expect(meetsBrowserFloor()).toBe(false)
    })

    it('fails when @property is unsupported (e.g. Firefox 113-127)', () => {
        stubFloor({ colorMix: true, propertyRule: false })
        expect(meetsBrowserFloor()).toBe(false)
    })

    it('fails when the CSS object or CSS.supports is missing entirely', () => {
        vi.stubGlobal('CSS', undefined)
        expect(meetsBrowserFloor()).toBe(false)
        vi.stubGlobal('CSS', {})
        expect(meetsBrowserFloor()).toBe(false)
    })
})

describe('BrowserSupportBanner', () => {
    let container: HTMLElement
    let root: Root

    beforeEach(() => {
        window.sessionStorage.clear()
        container = document.createElement('div')
        document.body.appendChild(container)
        root = createRoot(container)
    })

    afterEach(() => {
        act(() => root.unmount())
        container.remove()
        vi.unstubAllGlobals()
    })

    function render() {
        act(() => {
            root.render(createElement(BrowserSupportBanner))
        })
    }

    function banner(): Element | null {
        return container.querySelector('[role="status"]')
    }

    it('shows the warning on a browser below the floor', () => {
        stubFloor({ colorMix: false, propertyRule: false })
        render()
        expect(banner()).not.toBeNull()
        expect(banner()?.textContent).toContain('older than Solkey supports')
    })

    it('renders nothing on a supported browser', () => {
        stubFloor({ colorMix: true, propertyRule: true })
        render()
        expect(banner()).toBeNull()
    })

    it('dismisses on click and stays dismissed for the session', () => {
        stubFloor({ colorMix: false, propertyRule: false })
        render()
        const dismiss = container.querySelector<HTMLButtonElement>('button[aria-label="Dismiss"]')
        expect(dismiss).not.toBeNull()

        act(() => dismiss?.click())
        expect(banner()).toBeNull()

        // A fresh mount (next page) respects the stored dismissal.
        act(() => root.unmount())
        root = createRoot(container)
        render()
        expect(banner()).toBeNull()
    })

    it('still shows (and dismisses without crashing) when sessionStorage is blocked', () => {
        stubFloor({ colorMix: false, propertyRule: false })
        const original = Object.getOwnPropertyDescriptor(window, 'sessionStorage')
        Object.defineProperty(window, 'sessionStorage', {
            configurable: true,
            get() {
                throw new Error('storage disabled')
            },
        })
        try {
            render()
            expect(banner()).not.toBeNull()
            const dismiss = container.querySelector<HTMLButtonElement>('button[aria-label="Dismiss"]')
            expect(() => act(() => dismiss?.click())).not.toThrow()
            expect(banner()).toBeNull()
        } finally {
            if (original) Object.defineProperty(window, 'sessionStorage', original)
        }
    })
})
