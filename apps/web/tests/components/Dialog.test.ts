import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { DialogPanel } from '@/components/ui/Dialog'

// React's act() refuses to run outside a test-aware environment.
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

function pressEscape(target: EventTarget) {
    act(() => {
        target.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
    })
}

describe('DialogPanel', () => {
    let host: HTMLElement
    let root: Root
    let trigger: HTMLButtonElement

    const dialog = () => host.querySelector<HTMLElement>('[role="dialog"]')

    function open(onClose?: () => void, subtitle?: string) {
        act(() => {
            root.render(
                createElement(DialogPanel, {
                    title: 'Delete this score?',
                    subtitle,
                    width: 440,
                    onClose,
                    children: createElement('button', { type: 'button' }, 'Keep it'),
                }),
            )
        })
    }

    beforeEach(() => {
        trigger = document.createElement('button')
        host = document.createElement('div')
        document.body.append(trigger, host)
        trigger.focus()
        root = createRoot(host)
    })

    afterEach(() => {
        act(() => root.unmount())
        host.remove()
        trigger.remove()
    })

    it('is a labelled modal dialog that takes focus on open and hands it back on close', () => {
        open(vi.fn())
        const panel = dialog()
        expect(panel?.getAttribute('aria-modal')).toBe('true')
        const titleId = panel?.getAttribute('aria-labelledby') ?? ''
        expect(document.getElementById(titleId)?.textContent).toBe('Delete this score?')
        expect(panel?.parentElement?.contains(document.activeElement)).toBe(true)

        act(() => root.render(null))
        expect(document.activeElement).toBe(trigger)
    })

    it('is described by its subtitle, so the key sentence is read with the name', () => {
        open(vi.fn(), "'Scale Study' will be gone for good — there's no undo.")
        const describedBy = dialog()?.getAttribute('aria-describedby') ?? ''
        expect(document.getElementById(describedBy)?.textContent).toBe("'Scale Study' will be gone for good — there's no undo.")

        open(vi.fn())
        expect(dialog()?.hasAttribute('aria-describedby')).toBe(false)
    })

    it('calls onClose once for Escape inside the panel', () => {
        const onClose = vi.fn()
        open(onClose)
        pressEscape(host.querySelector('button') as HTMLButtonElement)
        expect(onClose).toHaveBeenCalledTimes(1)
    })

    it('still hears Escape after the focused control removed itself (focus fell to <body>)', () => {
        const onClose = vi.fn()
        open(onClose)
        pressEscape(document.body)
        expect(onClose).toHaveBeenCalledTimes(1)
    })

    it('closes from the backdrop and the header ×, but not from a click inside the panel', () => {
        const onClose = vi.fn()
        open(onClose)
        const scrim = dialog()?.parentElement?.parentElement as HTMLElement
        act(() => (dialog() as HTMLElement).click())
        expect(onClose).not.toHaveBeenCalled()
        act(() => scrim.click())
        expect(onClose).toHaveBeenCalledTimes(1)
        act(() => (host.querySelector('button[aria-label="Close"]') as HTMLButtonElement).click())
        expect(onClose).toHaveBeenCalledTimes(2)
    })

    it('without onClose it cannot be dismissed and shows no ×', () => {
        open(undefined)
        expect(host.querySelector('button[aria-label="Close"]')).toBeNull()
        pressEscape(document.body)
        act(() => (dialog()?.parentElement?.parentElement as HTMLElement).click())
        expect(dialog()).not.toBeNull()
    })
})
