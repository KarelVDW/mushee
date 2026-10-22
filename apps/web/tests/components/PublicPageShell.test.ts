import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/auth-client', () => ({ useSession: () => ({ data: null }) }))
vi.mock('@/lib/analytics', () => ({ track: vi.fn() }))
vi.mock('@/lib/queries', () => ({ useSignOut: () => ({ mutate: vi.fn() }) }))

import { PublicPageShell, ShortVersion } from '@/components/PublicPageShell'

function render(element: ReturnType<typeof createElement>): HTMLElement {
    const host = document.createElement('div')
    host.innerHTML = renderToStaticMarkup(element)
    return host
}

describe('PublicPageShell', () => {
    it('gives the skip link its target and leaves the prose out when a page has none', () => {
        const host = render(createElement(PublicPageShell, { title: 'Contact', lead: 'cards' }))
        expect(host.querySelector('main')?.id).toBe('content')
        expect(host.querySelector('h1')?.textContent).toBe('Contact')
        expect(host.querySelector('article')).toBeNull()
        expect(host.querySelector('a[href="#content"]')?.textContent).toBe('Skip to content')
    })
})

describe('ShortVersion', () => {
    it('opens a legal page with its plain points, the line that says which text binds, and the section links', () => {
        const host = render(
            createElement(ShortVersion, {
                points: ['We only listen while you’re recording.', 'Nothing is sold.'],
                closing: 'The full policy below is the one that counts.',
                sections: [
                    { id: 'controller', title: 'Who is responsible' },
                    { id: 'rights', title: 'Your rights' },
                ],
            }),
        )
        expect(host.querySelector('h2')?.textContent).toBe('The short version')
        expect([...host.querySelectorAll('li')].slice(0, 2).map((li) => li.textContent)).toEqual([
            'We only listen while you’re recording.',
            'Nothing is sold.',
        ])
        expect(host.textContent).toContain('The full policy below is the one that counts.')
        const toc = host.querySelector('nav[aria-label="On this page"]')
        expect([...(toc?.querySelectorAll('a') ?? [])].map((a) => a.getAttribute('href'))).toEqual(['#controller', '#rights'])
    })
})
