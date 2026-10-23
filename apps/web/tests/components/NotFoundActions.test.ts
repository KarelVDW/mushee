import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const visitor = vi.hoisted(() => ({ authed: false, pending: false }))

vi.mock('@/lib/auth-client', () => ({
    useSession: () => ({ data: visitor.authed ? { user: { id: 'u1' } } : null, isPending: visitor.pending }),
    useHydratedSession: () => ({ data: visitor.authed ? { user: { id: 'u1' } } : null, isPending: visitor.pending }),
}))

import NotFound from '@/app/not-found'
import { NotFoundActions } from '@/app/NotFoundActions'

function render() {
    const host = document.createElement('div')
    host.innerHTML = renderToStaticMarkup(createElement(NotFoundActions))
    return {
        text: host.querySelector('p')?.textContent,
        // The screen's own actions, not the wordmark's way home.
        links: [...host.querySelectorAll('a:not([aria-label="Solkey home"])')].map((a) => [a.textContent, a.getAttribute('href')]),
        heading: host.querySelector('h1')?.textContent,
    }
}

describe('NotFoundActions', () => {
    beforeEach(() => {
        visitor.authed = false
        visitor.pending = false
    })

    it('sends a signed-out visitor home, with sign-in as the quiet way in — not to a library', () => {
        const { text, links } = render()
        expect(text).toBe('The link may be old, or the address was mistyped.')
        expect(links).toEqual([
            ['Go to the home page', '/'],
            ['Sign in', '/login'],
        ])
    })

    it('sends a signed-in visitor back to their library and says their scores are safe', () => {
        visitor.authed = true
        const { text, links } = render()
        expect(text).toBe('The link may be old, or the address was mistyped. Your scores are safe.')
        expect(links).toEqual([
            ['Back to your library', '/scores'],
            ['Go home', '/'],
        ])
    })

    it('offers neither set until the session resolves', () => {
        visitor.pending = true
        expect(render().links).toEqual([])
    })

    it('is the neutral missing screen: the empty bar, never a fault’s well, and both ways out as buttons', () => {
        const host = document.createElement('div')
        host.innerHTML = renderToStaticMarkup(createElement(NotFoundActions))
        expect(host.querySelector('h1')?.textContent).toBe("This page doesn't exist")
        expect(host.querySelector('.bg-error-container')).toBeNull()
        expect(host.querySelector('svg line.stroke-outline-variant')).not.toBeNull()
        // Sign in is the screen's second button, as tall as the first.
        const signIn = host.querySelector('a[href="/login"]')
        expect(signIn?.className).toContain('rounded-full')
        expect(signIn?.className).toContain('h-(--control-md)')
    })

    it('sits in the page’s main landmark, the skip link’s target', () => {
        const host = document.createElement('div')
        host.innerHTML = renderToStaticMarkup(createElement(NotFound))
        expect(host.querySelectorAll('main')).toHaveLength(1)
        expect(host.querySelector('main#content h1')?.textContent).toBe("This page doesn't exist")
    })
})
