import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const account = vi.hoisted(() => ({ signOut: vi.fn() }))

vi.mock('@/lib/auth-client', () => ({
    useSession: () => ({ data: { user: { name: 'Ada Lovelace', email: 'ada@example.com' } } }),
}))
vi.mock('@/lib/queries', () => ({ useSignOut: () => account.signOut }))
vi.mock('next/navigation', () => ({ usePathname: () => '/scores' }))

import { SkipLink, TopNav } from '@/components/ui/Chrome'

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
