import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const visitor = vi.hoisted(() => ({ authed: false, pending: false }))

vi.mock('@/lib/auth-client', () => ({
    useSession: () => ({ data: visitor.authed ? { user: { id: 'u1' } } : null, isPending: visitor.pending }),
}))

import { NotFoundActions } from '@/app/NotFoundActions'

function render() {
    const host = document.createElement('div')
    host.innerHTML = renderToStaticMarkup(createElement(NotFoundActions))
    return {
        text: host.querySelector('p')?.textContent,
        links: [...host.querySelectorAll('a')].map((a) => [a.textContent, a.getAttribute('href')]),
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
})
