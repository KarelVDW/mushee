import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const account = vi.hoisted(() => ({ signOut: vi.fn() }))

vi.mock('@/lib/auth-client', () => ({
    useSession: () => ({ data: { user: { name: 'Ada Lovelace', email: 'ada@example.com' } } }),
    useHydratedSession: () => ({ data: { user: { name: 'Ada Lovelace', email: 'ada@example.com' } } }),
}))
vi.mock('@/lib/queries', () => ({ useSignOut: () => account.signOut }))
vi.mock('next/navigation', () => ({ usePathname: () => '/scores' }))

import { Footer, SkipLink, TopNav } from '@/components/ui/Chrome'

// React's act() refuses to run outside a test-aware environment.
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

describe('app chrome', () => {
    let host: HTMLElement
    let root: Root

    beforeEach(() => {
        account.signOut.mockReset()
        host = document.createElement('div')
        document.body.appendChild(host)
        root = createRoot(host)
    })

    afterEach(() => {
        act(() => root.unmount())
        host.remove()
    })

    it('the skip link comes first and moves focus to the main content', () => {
        const main = document.createElement('main')
        document.body.appendChild(main)
        act(() => root.render(createElement(TopNav, { user: 'Ada' })))
        const first = host.querySelector('a, button') as HTMLAnchorElement
        expect(first.textContent).toBe('Skip to content')
        expect(first.className).toContain('sr-only')
        expect(first.className).toContain('focus:not-sr-only')
        act(() => first.click())
        expect(document.activeElement).toBe(main)
        expect(main.getAttribute('tabindex')).toBe('-1')
        main.remove()
    })

    it('prefers the #content target when the page names one', () => {
        const content = document.createElement('div')
        content.id = 'content'
        document.body.appendChild(content)
        act(() => root.render(createElement(SkipLink)))
        act(() => (host.querySelector('a') as HTMLAnchorElement).click())
        expect(document.activeElement).toBe(content)
        content.remove()
    })

    it('the avatar opens the account menu: who is signed in, Settings and Sign out', () => {
        act(() => root.render(createElement(TopNav, { user: 'Ada' })))
        const avatar = host.querySelector('button[aria-label="Account menu"]') as HTMLButtonElement
        expect(avatar.getAttribute('aria-haspopup')).toBe('dialog')
        expect(avatar.getAttribute('aria-expanded')).toBe('false')
        act(() => avatar.click())
        const menu = host.querySelector('[role="dialog"][aria-label="Account menu"]') as HTMLElement
        expect(menu.textContent).toContain('Ada Lovelace')
        expect(menu.textContent).toContain('ada@example.com')
        expect(menu.querySelector('a[href="/settings"]')?.textContent).toBe('Settings')
        expect(avatar.getAttribute('aria-expanded')).toBe('true')

        const signOut = Array.from(menu.querySelectorAll('button')).find((b) => b.textContent === 'Sign out') as HTMLButtonElement
        act(() => signOut.click())
        expect(account.signOut).toHaveBeenCalledWith('/login')
    })

    it('the avatar is the soft identity tone, ringed on hover and while its menu is open', () => {
        act(() => root.render(createElement(TopNav, { user: 'Ada' })))
        const avatar = host.querySelector('button[aria-label="Account menu"]') as HTMLButtonElement
        expect(avatar.firstElementChild?.className).toContain('bg-secondary-soft')
        expect(avatar.className).toContain('aria-expanded:ring-2 aria-expanded:ring-secondary-soft')
        expect(avatar.className).toContain('aria-expanded:ring-offset-surface-container-low')
        expect(avatar.className).toContain('hover:ring-2 hover:ring-secondary-soft')
        // The menu is titled plainly, not with an eyebrow.
        act(() => avatar.click())
        expect(host.querySelector('[role="dialog"] h2')?.textContent).toBe('Account')
    })

    it('the New score CTA pops by default and can go flat where the page already leads with a pop CTA', () => {
        const ctas = () =>
            [...host.querySelectorAll<HTMLButtonElement>('button')].filter((b) =>
                /New score/.test(b.textContent + (b.getAttribute('aria-label') ?? '')),
            )
        act(() => root.render(createElement(TopNav, { user: 'Ada', onCreate: vi.fn() })))
        expect(ctas()).toHaveLength(2)
        expect(ctas().every((b) => b.className.includes('shadow-(--shadow-offset-3)'))).toBe(true)
        act(() => root.render(createElement(TopNav, { user: 'Ada', onCreate: vi.fn(), createEmphasis: 'flat' })))
        expect(ctas().some((b) => b.className.includes('shadow-(--shadow-offset-3)'))).toBe(false)
    })

    it('the nav sits on the app grid: the gutters outside the 1536px box', () => {
        act(() => root.render(createElement(TopNav, { user: 'Ada' })))
        const grid = host.querySelector('nav > div') as HTMLElement
        expect(grid.className).toBe('w-full px-4 sm:px-8')
        expect((grid.firstElementChild as HTMLElement).className).toContain('mx-auto max-w-384')
    })

    it('Escape closes the account menu and hands focus back to the avatar', () => {
        act(() => root.render(createElement(TopNav, { user: 'Ada' })))
        const avatar = host.querySelector('button[aria-label="Account menu"]') as HTMLButtonElement
        act(() => avatar.click())
        act(() => {
            document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
        })
        expect(host.querySelector('[role="dialog"]')).toBeNull()
        expect(document.activeElement).toBe(avatar)
    })
})

describe('Footer', () => {
    let host: HTMLElement
    let root: Root

    beforeEach(() => {
        host = document.createElement('div')
        document.body.appendChild(host)
        root = createRoot(host)
    })

    afterEach(() => {
        act(() => root.unmount())
        host.remove()
    })

    const linkTexts = () =>
        [...host.querySelectorAll('nav[aria-label="Site"] a, nav[aria-label="Site"] button')].map((el) => el.textContent)

    it('in the app: one quiet strip on the nav’s grid, with the site links', () => {
        act(() => root.render(createElement(Footer)))
        const footer = host.querySelector('footer') as HTMLElement
        expect(footer.firstElementChild?.className).toBe('w-full px-4 sm:px-8')
        expect(linkTexts()).toEqual(['Pricing', 'Privacy', 'Terms', 'Contact', 'Cookie settings'])
        expect(host.querySelector('nav a')?.className).toContain('text-[12px]')
    })

    it('on public pages: the 24px wordmark and 14px links in one row, the © line under them, no tagline', () => {
        act(() => root.render(createElement(Footer, { width: 'marketing' })))
        const footer = host.querySelector('footer') as HTMLElement
        const grid = footer.firstElementChild as HTMLElement
        expect(grid.className).toBe('w-full px-5 sm:px-8')
        const box = grid.firstElementChild as HTMLElement
        expect(box.className).toContain('max-w-320')
        expect(box.className).toContain('pt-12 pb-10')
        const [row, copyright] = Array.from(box.children) as HTMLElement[]
        expect(row.className).toContain('flex flex-col sm:flex-row sm:items-start justify-between gap-8')
        expect(copyright.className).toContain('mt-10')
        expect(copyright.textContent).toMatch(/^© \d{4} Solkey\.$/)
        expect(copyright.firstElementChild?.className).toContain('text-[13px]')
        const link = host.querySelector('nav a') as HTMLElement
        expect(link.className).toContain('text-[14px]')
        expect(link.className).toContain('pointer-coarse:py-3.25')
        expect(linkTexts()).toEqual(['Pricing', 'Privacy', 'Terms', 'Contact', 'Cookie settings'])
        // Wordmark, links, ©: nothing else.
        expect(footer.querySelectorAll('p')).toHaveLength(0)
    })
})
