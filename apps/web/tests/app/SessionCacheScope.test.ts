import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { SessionCacheScope } from '@/app/providers'

// React's act() refuses to run outside a test-aware environment.
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

type SessionState = { data: { user: { id: string } } | null; isPending: boolean }
let session: SessionState = { data: null, isPending: true }

vi.mock('@/lib/auth-client', () => ({ useSession: () => session }))

const signedIn = (id: string): SessionState => ({ data: { user: { id } }, isPending: false })
const signedOut: SessionState = { data: null, isPending: false }
const pending: SessionState = { data: null, isPending: true }

describe('SessionCacheScope', () => {
    let container: HTMLElement
    let root: Root
    let client: QueryClient

    beforeEach(() => {
        container = document.createElement('div')
        document.body.appendChild(container)
        root = createRoot(container)
        client = new QueryClient()
        session = pending
    })

    afterEach(() => {
        act(() => root.unmount())
        container.remove()
    })

    /** Renders the scope under `next`, with a cached user-scoped query to watch. */
    function renderWith(next: SessionState) {
        session = next
        act(() => root.render(createElement(QueryClientProvider, { client }, createElement(SessionCacheScope))))
    }
    const seed = () => client.setQueryData(['scores', 'list', ''], ['a score'])
    const cached = () => client.getQueryData(['scores', 'list', '']) !== undefined

    it('keeps the cache while the session resolves and when someone signs in', () => {
        renderWith(pending)
        seed()
        renderWith(signedOut)
        expect(cached()).toBe(true)
        renderWith(signedIn('a'))
        expect(cached()).toBe(true)
        renderWith(signedIn('a'))
        expect(cached()).toBe(true)
    })

    it('clears it when the signed-in user signs out', () => {
        renderWith(signedIn('a'))
        seed()
        renderWith(signedOut)
        expect(cached()).toBe(false)
    })

    it('clears it when another account takes the session', () => {
        renderWith(signedIn('a'))
        seed()
        renderWith(signedIn('b'))
        expect(cached()).toBe(false)
    })

    it('ignores a pending session in between', () => {
        renderWith(signedIn('a'))
        seed()
        renderWith(pending)
        expect(cached()).toBe(true)
        renderWith(signedIn('a'))
        expect(cached()).toBe(true)
    })
})
