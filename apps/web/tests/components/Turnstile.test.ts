import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { Turnstile } from '@/components/Turnstile'

// next/script needs Next's runtime; the widget is rendered through the global API either way.
vi.mock('next/script', () => ({ default: () => null }))
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

type Options = Record<string, unknown> & { callback: (token: string) => void; 'expired-callback': () => void }

describe('Turnstile', () => {
    let root: Root
    let host: HTMLDivElement
    let rendered: Array<{ container: HTMLElement; options: Options }>
    const remove = vi.fn()

    beforeEach(() => {
        rendered = []
        remove.mockClear()
        window.turnstile = {
            render: (container, options) => {
                rendered.push({ container, options: options as Options })
                return `widget-${rendered.length}`
            },
            remove,
        }
        host = document.createElement('div')
        document.body.appendChild(host)
        root = createRoot(host)
    })

    afterEach(() => {
        act(() => root.unmount())
        host.remove()
        delete window.turnstile
    })

    it('renders one widget with the site key and forwards tokens and expiry', () => {
        const onToken = vi.fn()
        act(() => root.render(createElement(Turnstile, { siteKey: '1x000', onToken })))

        expect(rendered).toHaveLength(1)
        expect(rendered[0].options).toMatchObject({ sitekey: '1x000', theme: 'light' })
        expect(rendered[0].container).toBe(host.querySelector('[data-testid="turnstile"]'))

        rendered[0].options.callback('tok-1')
        expect(onToken).toHaveBeenLastCalledWith('tok-1')
        rendered[0].options['expired-callback']()
        expect(onToken).toHaveBeenLastCalledWith(null)
    })

    it('does not render twice for the same mount and removes the widget on unmount', () => {
        act(() => root.render(createElement(Turnstile, { siteKey: '1x000', onToken: vi.fn() })))
        act(() => root.render(createElement(Turnstile, { siteKey: '1x000', onToken: vi.fn() }))) // re-render with a new callback
        expect(rendered).toHaveLength(1)

        act(() => root.unmount())
        expect(remove).toHaveBeenCalledWith('widget-1')
        root = createRoot(host) // afterEach unmounts a root; give it a fresh one
    })
})
