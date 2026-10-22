import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const nav = vi.hoisted(() => ({ pathname: '/' }))

vi.mock('next/navigation', () => ({ usePathname: () => nav.pathname }))

import { CookieConsent } from '@/components/CookieConsent'
import { getConsent, requestConsentSettings } from '@/lib/consent'

// React's act() refuses to run outside a test-aware environment.
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

describe('CookieConsent', () => {
    let host: HTMLElement
    let root: Root

    beforeEach(() => {
        nav.pathname = '/'
        window.localStorage.clear()
        document.body.style.paddingBottom = ''
        host = document.createElement('div')
        document.body.appendChild(host)
        root = createRoot(host)
    })

    afterEach(() => {
        act(() => root.unmount())
        host.remove()
    })

    const render = () => act(() => root.render(createElement(CookieConsent)))
    const banner = () => document.querySelector('[role="dialog"][aria-label="Cookie consent"]')
    const button = (name: string) => [...document.querySelectorAll('button')].find((b) => b.textContent === name)

    it('asks on a first visit with the two equal choices first and Customize after them', () => {
        render()
        expect(banner()).not.toBeNull()
        expect([...(banner()?.querySelectorAll('button') ?? [])].map((b) => b.textContent)).toEqual([
            'Essential only',
            'Accept all',
            'Customize',
        ])
    })

    it('is a solid card, never glass, and a full-width bottom sheet on phones', () => {
        render()
        const classes = banner()?.className ?? ''
        expect(classes).toContain('bg-surface-container-lowest')
        expect(classes).not.toContain('glass-panel')
        expect(classes).toContain('inset-x-0')
        expect(classes).toContain('rounded-t-xl')
        expect(classes).toContain('pb-[max(1rem,env(safe-area-inset-bottom))]')
    })

    it('says what it asks in plain words: a short version on phones, the full one from sm up', () => {
        render()
        const [phone, desktop] = [...(banner()?.querySelectorAll('p > span') ?? [])]
        expect(phone.className).toContain('sm:hidden')
        expect(phone.textContent).toContain('Session replay is optional')
        expect(desktop.className).toContain('max-sm:hidden')
        expect(desktop.textContent).toContain('counts visits without cookies')
        expect(desktop.textContent).toContain('linked to your account')
    })

    it('pads a document page under the banner while it shows, and stops once decided', () => {
        render()
        expect(document.body.style.paddingBottom).toMatch(/^\d+px$/)
        act(() => button('Essential only')?.click())
        expect(banner()).toBeNull()
        expect(document.body.style.paddingBottom).toBe('')
        expect(getConsent()?.analytics).toBe(false)
    })

    it('leaves the full-height editor and library unpadded', () => {
        nav.pathname = '/scores/abc'
        render()
        expect(banner()).not.toBeNull()
        expect(document.body.style.paddingBottom).toBe('')
    })

    it('names the replay switch for what it enables, both always-on categories plainly', () => {
        render()
        act(() => button('Customize')?.click())
        const dialog = document.querySelector('[role="dialog"]')
        expect(dialog?.textContent).toContain('Cookie preferences')
        // The switch is named by its wrapping <label>.
        expect(document.querySelector('[role="switch"]')?.closest('label')?.textContent).toBe('Screen replays to help us fix bugs')
        expect(dialog?.textContent).toContain('what you type stays hidden')
        expect(dialog?.textContent).not.toContain('Always on · no cookies')
        expect(dialog?.textContent?.match(/Always on/g)).toHaveLength(2)
    })

    it('reopens from the footer’s Cookie settings once decided', () => {
        render()
        act(() => button('Accept all')?.click())
        expect(banner()).toBeNull()
        act(() => requestConsentSettings())
        expect(document.querySelector('[role="dialog"]')?.textContent).toContain('Cookie preferences')
    })
})
