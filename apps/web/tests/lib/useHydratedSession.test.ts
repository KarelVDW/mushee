import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { renderToString } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

// React's act() refuses to run outside a test-aware environment.
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

// A client that already holds a session — the case that made the landing page's hydration
// render disagree with the server's HTML.
vi.mock('better-auth/react', () => ({
    createAuthClient: () => ({ useSession: () => ({ data: { user: { name: 'Ada' } }, isPending: false }) }),
}))
vi.mock('better-auth/client/plugins', () => ({ emailOTPClient: () => ({}) }))

const { useHydratedSession } = await import('@/lib/auth-client')

function Who() {
    const { data } = useHydratedSession()
    return createElement('span', null, data?.user ? 'signed in' : 'signed out')
}

describe('useHydratedSession', () => {
    it('renders as signed out on the server, whatever the client already knows', () => {
        expect(renderToString(createElement(Who))).toContain('signed out')
    })

    it('reports the real session on the client', () => {
        const host = document.createElement('div')
        const root = createRoot(host)
        act(() => root.render(createElement(Who)))
        expect(host.textContent).toBe('signed in')
        act(() => root.unmount())
    })
})
