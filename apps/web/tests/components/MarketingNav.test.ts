import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const visitor = vi.hoisted(() => ({ authed: false }))

vi.mock('@/lib/auth-client', () => ({
    useSession: () => ({ data: visitor.authed ? { user: { id: 'u1' } } : null }),
    useHydratedSession: () => ({ data: visitor.authed ? { user: { id: 'u1' } } : null }),
}))
vi.mock('@/lib/analytics', () => ({ track: vi.fn() }))

import { MarketingNav } from '@/components/marketing/MarketingNav'

const html = (props: Parameters<typeof MarketingNav>[0], ...children: string[]) =>
    renderToStaticMarkup(createElement(MarketingNav, props, ...children))

describe('MarketingNav', () => {
    beforeEach(() => {
        visitor.authed = false
    })

    it('links the wordmark home and offers sign-in plus the CTA by default', () => {
        const markup = html({})
        expect(markup).toContain('aria-label="Solkey home"')
        expect(markup).toContain('href="/login"')
        expect(markup).toContain('href="/signup"')
        expect(markup).not.toContain('href="#how"')
    })

    it('adds the landing page’s own section links on request', () => {
        const markup = html({ sectionLinks: 'landing' })
        expect(markup).toContain('href="#how"')
        expect(markup).toContain('href="#features"')
        expect(markup).toContain('href="/pricing"')
    })

    it('points the section links home from /pricing and marks Pricing as the page', () => {
        const host = document.createElement('div')
        host.innerHTML = html({ sectionLinks: 'pricing' })
        expect(host.querySelector('a[href="/#how"]')).not.toBeNull()
        expect(host.querySelector('a[href="/#features"]')).not.toBeNull()
        const pricing = host.querySelector('a[href="/pricing"]')
        expect(pricing?.getAttribute('aria-current')).toBe('page')
        expect(pricing?.className).toContain('border-primary-container')
        expect(host.querySelector('a[href="/#how"]')?.hasAttribute('aria-current')).toBe(false)
    })

    it('is the page banner: a header around the Primary nav', () => {
        const host = document.createElement('div')
        host.innerHTML = html({})
        expect(host.firstElementChild?.tagName).toBe('HEADER')
        expect(host.querySelector('header > nav[aria-label="Primary"]')).not.toBeNull()
    })

    it('sets Sign in like its neighbours, not as a button', () => {
        const host = document.createElement('div')
        host.innerHTML = html({ sectionLinks: 'landing' })
        const signIn = host.querySelector('a[href="/login"]')
        const pricing = host.querySelector('a[href="/pricing"]')
        for (const cls of ['font-body', 'font-medium', 'text-[14px]', 'text-on-surface-variant', 'hover:text-on-surface']) {
            expect(signIn?.className, cls).toContain(cls)
            expect(pricing?.className, cls).toContain(cls)
        }
        // Sign in stays on phones; the section links don't.
        expect(signIn?.className).not.toContain('max-md:hidden')
        expect(pricing?.className).toContain('max-md:hidden')
    })

    it('hides sign-in from a signed-in visitor', () => {
        visitor.authed = true
        const markup = html({})
        expect(markup).not.toContain('href="/login"')
        expect(markup).toContain('href="/scores"')
    })

    it('starts with a skip link to the page’s main content', () => {
        const host = document.createElement('div')
        host.innerHTML = html({ sectionLinks: 'landing' })
        const first = host.querySelector('a, button')
        expect(first?.textContent).toBe('Skip to content')
        expect(first?.getAttribute('href')).toBe('#content')
    })

    it('grows the wordmark and section links to a 40px target on touch', () => {
        const host = document.createElement('div')
        host.innerHTML = html({ sectionLinks: 'landing' })
        for (const selector of ['a[aria-label="Solkey home"]', 'a[href="#how"]', 'a[href="#features"]', 'a[href="/pricing"]']) {
            expect(host.querySelector(selector)?.className, selector).toContain('pointer-coarse:min-h-10')
        }
    })

    it('renders the given actions in place of the defaults', () => {
        const markup = html({}, 'Back to Solkey')
        expect(markup).toContain('Back to Solkey')
        expect(markup).not.toContain('href="/login"')
        expect(markup).not.toContain('href="/signup"')
    })
})
