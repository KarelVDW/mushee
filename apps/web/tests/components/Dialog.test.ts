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

    it('is an opaque white panel that hangs from the top on sm+ and is a bottom sheet on phones', () => {
        open(vi.fn())
        const panel = dialog() as HTMLElement
        expect(panel.className).toContain('bg-surface-container-lowest')
        expect(panel.className).toContain('shadow-overlay')
        expect(panel.className).not.toContain('glass-panel')
        expect(panel.className).toContain('animate-dialog-in')
        expect(panel.className).toContain('max-sm:rounded-t-xl')
        // The width rides in as a variable, so the phone sheet's full width can override it.
        expect(panel.style.getPropertyValue('--dialog-w')).toBe('440px')
        expect(panel.style.width).toBe('')
        const scrim = panel.parentElement?.parentElement as HTMLElement
        expect(scrim.className).toContain('sm:items-start')
        expect(scrim.className).toContain('max-sm:items-end')
        expect(scrim.className).toContain('animate-scrim-in')
    })

    describe('footer', () => {
        function openWithFooter() {
            act(() => {
                root.render(
                    createElement(DialogPanel, {
                        title: 'Delete this score?',
                        width: 440,
                        onClose: vi.fn(),
                        footer: [
                            createElement('button', { key: 'cancel', type: 'button' }, 'Cancel'),
                            createElement('button', { key: 'delete', type: 'button' }, 'Delete'),
                        ],
                    }),
                )
            })
            return host.querySelector('footer') as HTMLElement
        }

        afterEach(() => {
            vi.unstubAllGlobals()
            document.documentElement.style.removeProperty('--toast-bottom')
        })

        it('keeps its children in order, the primary last — stacked on top, full width, on phones', () => {
            const footer = openWithFooter()
            expect([...footer.children].map((child) => child.textContent)).toEqual(['Cancel', 'Delete'])
            expect(footer.className).toContain('max-sm:flex-col-reverse')
            // A tooltip-wrapped primary fills the width too.
            expect(footer.className).toContain('max-sm:[&>*]:w-full')
            expect(footer.className).toContain('max-sm:[&>*>button]:w-full')
        })

        it('lifts toasts above a phone sheet’s footer while open, and gives the page its own value back on close', () => {
            vi.stubGlobal('matchMedia', (query: string) => ({
                matches: query.includes('max-width'),
                addEventListener: () => undefined,
                removeEventListener: () => undefined,
            }))
            const style = document.documentElement.style
            style.setProperty('--toast-bottom', '96px')
            openWithFooter()
            // jsdom lays nothing out: a 0px footer plus the 12px gap.
            expect(style.getPropertyValue('--toast-bottom')).toBe('12px')
            act(() => root.render(null))
            expect(style.getPropertyValue('--toast-bottom')).toBe('96px')

            style.removeProperty('--toast-bottom')
            openWithFooter()
            expect(style.getPropertyValue('--toast-bottom')).toBe('12px')
            act(() => root.render(null))
            expect(style.getPropertyValue('--toast-bottom')).toBe('')
        })

        it('leaves the toasts alone on wider screens', () => {
            vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener: () => undefined, removeEventListener: () => undefined }))
            openWithFooter()
            expect(document.documentElement.style.getPropertyValue('--toast-bottom')).toBe('')
        })
    })

    it('without onClose it cannot be dismissed and shows no ×', () => {
        open(undefined)
        expect(host.querySelector('button[aria-label="Close"]')).toBeNull()
        pressEscape(document.body)
        act(() => (dialog()?.parentElement?.parentElement as HTMLElement).click())
        expect(dialog()).not.toBeNull()
    })
})
