import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { Popover } from '@/components/ui/Popover'

// React's act() refuses to run outside a test-aware environment.
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

/** Dispatch a bubbling keydown at `target`, as the browser would for a key press. */
function press(target: EventTarget, key: string): KeyboardEvent {
    const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })
    target.dispatchEvent(event)
    return event
}

describe('Popover keyboard isolation', () => {
    let host: HTMLElement
    let root: Root
    // Stands in for the editor: its keydown listener sits on an ancestor of everything on the page.
    let editorKeys: string[]
    const onEditorKey = (e: KeyboardEvent) => editorKeys.push(e.key)

    function render(props: { onDismiss: () => void; onKeyDown?: (e: KeyboardEvent) => void }) {
        act(() => {
            root.render(
                createElement(
                    Popover,
                    { ariaLabel: 'Select clef', title: 'Clef', ...props },
                    createElement('button', { type: 'button' }, 'Treble'),
                ),
            )
        })
    }

    beforeEach(() => {
        editorKeys = []
        host = document.createElement('div')
        document.body.appendChild(host)
        host.addEventListener('keydown', onEditorKey)
        root = createRoot(host)
    })

    afterEach(() => {
        act(() => root.unmount())
        host.removeEventListener('keydown', onEditorKey)
        host.remove()
    })

    it('Escape dismisses without reaching the editor', () => {
        const onDismiss = vi.fn()
        render({ onDismiss })
        const event = press(host, 'Escape')
        expect(onDismiss).toHaveBeenCalledTimes(1)
        expect(event.defaultPrevented).toBe(true)
        expect(editorKeys).toEqual([])
    })

    it('hands every other key to onKeyDown and keeps it from the editor', () => {
        const onKeyDown = vi.fn()
        const onDismiss = vi.fn()
        render({ onDismiss, onKeyDown })
        const button = host.querySelector('button') as HTMLButtonElement
        const event = press(button, 'r')
        expect(onKeyDown).toHaveBeenCalledTimes(1)
        expect(onKeyDown.mock.calls[0][0]).toBe(event)
        expect(onDismiss).not.toHaveBeenCalled()
        expect(editorKeys).toEqual([])
        // Not cancelled: the key's default action (typing, pressing a focused button) still runs.
        expect(event.defaultPrevented).toBe(false)
    })

    it('stops listening once unmounted', () => {
        render({ onDismiss: vi.fn() })
        act(() => root.render(null))
        press(host, 'r')
        expect(editorKeys).toEqual(['r'])
    })
})
