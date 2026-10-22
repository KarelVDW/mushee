import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { HeaderMenu } from '@/components/ui/HeaderMenu'

// React's act() refuses to run outside a test-aware environment.
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

describe('HeaderMenu', () => {
    let host: HTMLElement
    let root: Root
    let outside: HTMLButtonElement

    const chip = () => host.querySelector<HTMLButtonElement>('button[aria-label="Export score"]') as HTMLButtonElement
    const panel = () => host.querySelector<HTMLElement>('[role="dialog"]')

    function render(children: Parameters<typeof HeaderMenu>[0]['children']) {
        act(() => {
            root.render(
                createElement(HeaderMenu, { icon: 'download', label: 'Export', ariaLabel: 'Export score', title: 'Export as', children }),
            )
        })
    }

    function pressEscape() {
        act(() => {
            document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
        })
    }

    beforeEach(() => {
        host = document.createElement('div')
        outside = document.createElement('button')
        document.body.append(host, outside)
        root = createRoot(host)
    })

    afterEach(() => {
        act(() => root.unmount())
        host.remove()
        outside.remove()
    })

    it('opens from its chip and moves focus to the first control in the panel', () => {
        render(createElement('button', { type: 'button' }, 'MusicXML'))
        expect(panel()).toBeNull()
        act(() => chip().click())
        expect(panel()?.getAttribute('aria-label')).toBe('Export score')
        expect(chip().getAttribute('aria-pressed')).toBe('true')
        expect(document.activeElement?.textContent).toBe('MusicXML')
    })

    it('returns focus to the chip when Escape closes it with focus inside', () => {
        render(createElement('button', { type: 'button' }, 'MusicXML'))
        act(() => chip().click())
        pressEscape()
        expect(panel()).toBeNull()
        expect(document.activeElement).toBe(chip())
    })

    it('leaves focus alone when it already moved out of the panel', () => {
        render(createElement('button', { type: 'button' }, 'MusicXML'))
        act(() => chip().click())
        outside.focus()
        act(() => chip().click())
        expect(panel()).toBeNull()
        expect(document.activeElement).toBe(outside)
    })

    it('hands a render-prop child the close callback', () => {
        render(({ close }) => createElement('button', { type: 'button', onClick: close }, 'Done'))
        act(() => chip().click())
        act(() => (document.activeElement as HTMLButtonElement).click())
        expect(panel()).toBeNull()
        expect(document.activeElement).toBe(chip())
    })
})
