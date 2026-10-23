import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const nav = vi.hoisted(() => ({ pathname: '/' as string | null }))

vi.mock('next/navigation', () => ({ usePathname: () => nav.pathname }))

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
        nav.pathname = '/'
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

    it('advises an update on a browser below the floor, iPhone included', () => {
        stubFloor({ colorMix: false, propertyRule: false })
        render()
        expect(banner()).not.toBeNull()
        expect(banner()?.getAttribute('aria-label')).toBe('Unsupported browser')
        expect(banner()?.textContent).toContain('Your browser is a bit old for Solkey')
        expect(banner()?.textContent).toContain('on iPhone or iPad, that means updating iOS')
    })

    it('reads as advice, not a crash: a quiet white strip with a 40px dismiss', () => {
        stubFloor({ colorMix: false, propertyRule: false })
        render()
        expect(banner()?.className).toContain('bg-surface-container-lowest')
        expect(banner()?.querySelector('.bg-error-container')).toBeNull()
        expect(container.querySelector('button[aria-label="Dismiss"]')?.className).toContain('w-10 h-10')
    })

    it('leads with what is off, then how to fix it', () => {
        stubFloor({ colorMix: false, propertyRule: false })
        render()
        const lead = banner()?.querySelector('p > .font-medium')
        expect(lead?.textContent).toBe('Your browser is a bit old for Solkey, so some things may look off and recording may not work.')
        expect(lead?.className).toContain('text-on-surface')
        expect(banner()?.querySelector('p')?.className).toContain('text-on-surface-variant')
    })

    it('sits in the flow of a document page, covering nothing, in line with the page content', () => {
        stubFloor({ colorMix: false, propertyRule: false })
        render()
        expect(banner()?.className).not.toContain('fixed')
        // The marketing container recipe, so its icon lines up with the wordmark below.
        expect(banner()?.firstElementChild?.className).toContain('max-w-320 mx-auto px-5 sm:px-8')
    })

    it('floats over the full-height editor and library, clear of the header and the dock, so their chrome stays on screen', () => {
        stubFloor({ colorMix: false, propertyRule: false })
        nav.pathname = '/scores/abc'
        render()
        const classes = banner()?.className ?? ''
        expect(classes).toContain('fixed')
        // Phones: under the header. Wider: bottom left, above the dock — never over the transport.
        // Without a published header height (the library), the library nav's own height.
        expect(classes).toContain('top-[calc(var(--app-header-h,calc(var(--control-md)+1.75rem))+8px)]')
        expect(classes).toContain('md:bottom-[calc(var(--dock-h,0px)+12px)]')
        expect(classes).toContain('md:left-4')
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
