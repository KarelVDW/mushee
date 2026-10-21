import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const visitor = vi.hoisted(() => ({ authed: false }))

vi.mock('@/lib/auth-client', () => ({
    useSession: () => ({ data: visitor.authed ? { user: { id: 'u1' } } : null }),
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
        const markup = html({ sectionLinks: true })
        expect(markup).toContain('href="#how"')
        expect(markup).toContain('href="#features"')
        expect(markup).toContain('href="/pricing"')
    })

    it('hides sign-in from a signed-in visitor', () => {
        visitor.authed = true
        const markup = html({})
        expect(markup).not.toContain('href="/login"')
        expect(markup).toContain('href="/scores"')
    })

    it('renders the given actions in place of the defaults', () => {
        const markup = html({}, 'Back to Solkey')
        expect(markup).toContain('Back to Solkey')
        expect(markup).not.toContain('href="/login"')
        expect(markup).not.toContain('href="/signup"')
    })
})
