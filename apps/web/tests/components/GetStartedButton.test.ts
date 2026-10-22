import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const visitor = vi.hoisted(() => ({ authed: false, beta: false }))
const { track } = vi.hoisted(() => ({ track: vi.fn() }))

vi.mock('@/lib/auth-client', () => ({
    useSession: () => ({ data: visitor.authed ? { user: { id: 'u1' } } : null }),
}))
vi.mock('@/lib/analytics', () => ({ track }))
vi.mock('@/lib/plans', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@/lib/plans')>()),
    get BETA_MODE() {
        return visitor.beta
    },
}))

import { GetStartedButton } from '@/components/marketing/GetStartedButton'

// React's act() refuses to run outside a test-aware environment.
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

type Props = Parameters<typeof GetStartedButton>[0]
const html = (props: Props) => renderToStaticMarkup(createElement(GetStartedButton, props))
const hrefOf = (markup: string) => /href="([^"]*)"/.exec(markup)?.[1]?.replace(/&amp;/g, '&')

describe('GetStartedButton', () => {
    beforeEach(() => {
        visitor.authed = false
        visitor.beta = false
        track.mockClear()
    })

    it('sends a signed-out visitor to signup, labelled from the one table', () => {
        const markup = html({ location: 'hero' })
        expect(markup).toMatch(/^<a /)
        expect(hrefOf(markup)).toBe('/signup')
        expect(markup).toContain('Start free')

        visitor.beta = true
        expect(html({ location: 'hero' })).toContain('Request access')
    })

    it('sends a signed-in visitor to the library', () => {
        visitor.authed = true
        const markup = html({ location: 'nav' })
        expect(hrefOf(markup)).toBe('/scores')
        expect(markup).toContain('Open library')
    })

    it('carries a way back through signup', () => {
        expect(hrefOf(html({ location: 'shared-score', next: '/s/abc' }))).toBe(`/signup?next=${encodeURIComponent('/s/abc')}`)
        visitor.authed = true
        expect(hrefOf(html({ location: 'shared-score', next: '/s/abc' }))).toBe('/scores')
    })

    it('takes the tier a pricing card names to signup, or to the plan dialog when signed in', () => {
        expect(hrefOf(html({ location: 'pricing', plan: 'studio', children: 'Go Studio' }))).toBe('/signup?plan=studio')
        expect(hrefOf(html({ location: 'pricing', plan: 'pro', next: '/s/abc' }))).toBe(
            `/signup?next=${encodeURIComponent('/s/abc')}&plan=pro`,
        )
        visitor.authed = true
        expect(hrefOf(html({ location: 'pricing', plan: 'arranger', children: 'Go Arranger' }))).toBe('/settings?plan=arranger')
    })

    it('keeps the Sketch card a library link when signed in, never a cancel-preselected plan dialog', () => {
        expect(hrefOf(html({ location: 'pricing', plan: 'free', children: 'Start sketching' }))).toBe('/signup?plan=free')
        visitor.authed = true
        expect(hrefOf(html({ location: 'pricing', plan: 'free', children: 'Start sketching' }))).toBe('/scores')
    })

    it('lets children replace the label and its arrow; secondary keeps the link', () => {
        const generic = html({ location: 'nav' })
        const named = html({ location: 'pricing', children: 'Go Studio' })
        expect(generic).toContain('<svg')
        expect(named).toContain('Go Studio')
        expect(named).not.toContain('Start free')
        expect(named).not.toContain('<svg')

        const secondary = html({ location: 'pricing', variant: 'secondary', fullWidth: true, children: 'Start sketching' })
        expect(secondary).toMatch(/^<a /)
        expect(secondary).toContain('w-full')
    })

    it('tracks the click with its location and the beta flag', () => {
        const host = document.createElement('div')
        const root = createRoot(host)
        act(() => root.render(createElement(GetStartedButton, { location: 'footer' })))
        // Stop the link's own navigation: only the tracking is under test.
        host.addEventListener('click', (e) => e.preventDefault())
        act(() => host.querySelector('a')?.click())
        expect(track).toHaveBeenCalledWith('landing_cta_clicked', { location: 'footer', beta: false })
        act(() => root.unmount())
    })
})
