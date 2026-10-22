import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { useDocumentTitle } from '@/lib/useDocumentTitle'

// React's act() refuses to run outside a test-aware environment.
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

function Titled({ title }: { title: string | null }) {
    useDocumentTitle(title)
    return null
}

/** A late `<title>` the way Next streams the route's metadata in: a new element in <head>. */
function streamTitle(text: string) {
    const element = document.createElement('title')
    element.textContent = text
    document.head.prepend(element)
}

/** MutationObserver callbacks run as microtasks. */
const settle = () => act(async () => await Promise.resolve())

describe('useDocumentTitle', () => {
    let container: HTMLElement
    let root: Root

    beforeEach(() => {
        document.head.querySelectorAll('title').forEach((element) => element.remove())
        document.title = 'Untitled score — Solkey'
        container = document.createElement('div')
        document.body.appendChild(container)
        root = createRoot(container)
    })

    afterEach(() => {
        act(() => root.unmount())
        container.remove()
    })

    it('names the tab, and follows the title as it changes', () => {
        act(() => root.render(createElement(Titled, { title: 'Morning song — Solkey' })))
        expect(document.title).toBe('Morning song — Solkey')
        act(() => root.render(createElement(Titled, { title: 'Evening song — Solkey' })))
        expect(document.title).toBe('Evening song — Solkey')
    })

    it('leaves the route’s own title alone while it has none', () => {
        act(() => root.render(createElement(Titled, { title: null })))
        expect(document.title).toBe('Untitled score — Solkey')
    })

    it('stays on top of a metadata title streamed in after it', async () => {
        act(() => root.render(createElement(Titled, { title: 'Morning song — Solkey' })))
        streamTitle('Shared score — Solkey')
        await settle()
        expect(document.title).toBe('Morning song — Solkey')
        // An edit to the existing title's text is caught too.
        const first = document.head.querySelector('title')
        if (first) first.textContent = 'Shared score — Solkey'
        await settle()
        expect(document.title).toBe('Morning song — Solkey')
    })

    it('holds when the metadata title sits in the body and hydration puts the server’s text back', async () => {
        // Next can stream the metadata into the body, and only that title is there.
        document.head.querySelectorAll('title').forEach((element) => element.remove())
        const streamed = document.createElement('title')
        streamed.textContent = 'Shared score — Solkey'
        document.body.append(streamed)
        act(() => root.render(createElement(Titled, { title: 'Morning song — Solkey' })))
        expect(document.title).toBe('Morning song — Solkey')
        // Hydration rewrites its text node in place…
        const text = streamed.firstChild
        if (text) text.nodeValue = 'Shared score — Solkey'
        await settle()
        expect(document.title).toBe('Morning song — Solkey')
        // …or a client render swaps a fresh one in further down the body.
        streamed.remove()
        const wrapper = document.createElement('div')
        const fresh = document.createElement('title')
        fresh.textContent = 'Shared score — Solkey'
        wrapper.append(fresh)
        document.body.append(wrapper)
        await settle()
        expect(document.title).toBe('Morning song — Solkey')
        wrapper.remove()
    })

    it('puts the tab back on the way out while it still reads this title', () => {
        act(() => root.render(createElement(Titled, { title: 'Morning song — Solkey' })))
        act(() => root.unmount())
        expect(document.title).toBe('Untitled score — Solkey')
        root = createRoot(container)
    })

    it('keeps a title the next route brought, and stops watching', async () => {
        act(() => root.render(createElement(Titled, { title: 'Morning song — Solkey' })))
        document.title = 'Your scores — Solkey'
        act(() => root.unmount())
        expect(document.title).toBe('Your scores — Solkey')
        streamTitle('Settings — Solkey')
        await settle()
        expect(document.title).toBe('Settings — Solkey')
        root = createRoot(container)
    })
})
