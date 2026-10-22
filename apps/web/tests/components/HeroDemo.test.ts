import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const env = vi.hoisted(() => ({ exampleToken: undefined as string | undefined }))

vi.mock('@/lib/env', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@/lib/env')>()),
    get EXAMPLE_SHARE_TOKEN() {
        return env.exampleToken
    },
}))

import { HeroDemo } from '@/app/HeroDemo'

// React's act() refuses to run outside a test-aware environment.
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

function stubReducedMotion(reduce: boolean) {
    vi.stubGlobal(
        'matchMedia',
        vi.fn((query: string) => ({
            matches: reduce && query.includes('prefers-reduced-motion'),
            media: query,
            addEventListener: () => {},
            removeEventListener: () => {},
        })),
    )
}

describe('HeroDemo', () => {
    let host: HTMLElement
    let root: Root

    beforeEach(() => {
        env.exampleToken = undefined
        host = document.createElement('div')
        document.body.appendChild(host)
        root = createRoot(host)
    })

    afterEach(() => {
        act(() => root.unmount())
        host.remove()
        vi.unstubAllGlobals()
    })

    const render = () => act(() => root.render(createElement(HeroDemo)))
    const toggle = () => host.querySelector<HTMLButtonElement>('button[aria-label$=" demo"]')
    const firstNote = () => host.querySelector('[role="img"] svg g[opacity]')

    it('names the demo as one image and says what it shows in a caption', () => {
        stubReducedMotion(false)
        render()
        expect(host.querySelector('[role="img"]')?.getAttribute('aria-label')).toBe('Demo: a hummed melody turning into notes on a staff')
        expect(host.querySelector('p')?.textContent).toBe("Someone humming Frère Jacques. Each note appears a moment after it's sung.")
        // The tempo readout is gone: the REC and Saved chips carry the story.
        expect(host.querySelector('[role="img"]')?.textContent).not.toContain('♩')
    })

    it('pauses the loop on the finished sheet, and plays it again', () => {
        stubReducedMotion(false)
        render()
        expect(toggle()?.getAttribute('aria-label')).toBe('Pause demo')
        // The pause control sits beside the image, never inside it (an img's children are presentational).
        expect(host.querySelector('[role="img"] button')).toBeNull()
        expect(firstNote()?.getAttribute('opacity')).toBe('0')

        act(() => toggle()?.click())
        expect(toggle()?.getAttribute('aria-label')).toBe('Play demo')
        expect(firstNote()?.getAttribute('opacity')).toBe('1')

        act(() => toggle()?.click())
        expect(toggle()?.getAttribute('aria-label')).toBe('Pause demo')
    })

    it('shows the finished sheet, with no pause control, under reduced motion', () => {
        stubReducedMotion(true)
        render()
        expect(toggle()).toBeNull()
        expect(firstNote()?.getAttribute('opacity')).toBe('1')
    })

    it('offers the example score only where this environment has one', () => {
        stubReducedMotion(false)
        render()
        expect(host.querySelector('a[href^="/s/"]')).toBeNull()

        env.exampleToken = 'solkey-example-frere-jacques'
        render()
        const example = host.querySelector('a[href="/s/solkey-example-frere-jacques"]')
        expect(example?.textContent).toBe('Hear an example')
    })
})
