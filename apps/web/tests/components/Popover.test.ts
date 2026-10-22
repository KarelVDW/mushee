import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { Popover, PopoverSheetHost, SHEET_PICK_CONFIRM_MS, usePickConfirmation } from '@/components/ui/Popover'

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
                createElement(Popover, {
                    ariaLabel: 'Select clef',
                    title: 'Clef',
                    ...props,
                    children: createElement('button', { type: 'button' }, 'Treble'),
                }),
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

    it("cancels Backspace's history-back default on a control, but not in a text field", () => {
        const onKeyDown = vi.fn()
        render({ onDismiss: vi.fn(), onKeyDown })
        const button = host.querySelector('button') as HTMLButtonElement
        const onButton = press(button, 'Backspace')
        expect(onButton.defaultPrevented).toBe(true)
        expect(onKeyDown).toHaveBeenCalledWith(onButton)
        expect(editorKeys).toEqual([])

        const input = document.createElement('input')
        host.querySelector('[role="dialog"]')?.appendChild(input)
        expect(press(input, 'Backspace').defaultPrevented).toBe(false)
    })

    it('stops listening once unmounted', () => {
        render({ onDismiss: vi.fn() })
        act(() => root.render(null))
        press(host, 'r')
        expect(editorKeys).toEqual(['r'])
    })
})

describe('Popover surfaces', () => {
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

    const option = () => createElement('button', { type: 'button' }, 'Treble')

    it('anchored: an opaque card with the eyebrow and the one-line hint under it', () => {
        act(() => {
            root.render(
                createElement(Popover, {
                    ariaLabel: 'Select clef',
                    title: 'Clef',
                    hint: 'Which notes the lines stand for.',
                    onDismiss: vi.fn(),
                    children: option(),
                }),
            )
        })
        const panel = host.querySelector<HTMLElement>('[role="dialog"]') as HTMLElement
        expect(panel.className).toContain('bg-surface-container-lowest')
        expect(panel.className).toContain('editorial-shadow')
        expect(panel.className).not.toContain('glass-panel')
        const [eyebrow, hint] = Array.from(panel.children)
        expect(eyebrow.textContent).toBe('Clef')
        expect(hint.textContent).toBe('Which notes the lines stand for.')
        expect(hint.className).toContain('text-[13px]')
    })

    describe('sheet', () => {
        let trigger: HTMLButtonElement
        const anchorRef = { current: null as HTMLElement | null }

        function renderSheet(onDismiss: () => void, open = true) {
            act(() => {
                root.render(
                    createElement(PopoverSheetHost, {
                        children: createElement(
                            'div',
                            null,
                            createElement(
                                'div',
                                { ref: (el: HTMLElement | null) => void (anchorRef.current = el) },
                                createElement('button', { type: 'button' }, 'Clef'),
                            ),
                            open &&
                                createElement(Popover, {
                                    variant: 'sheet',
                                    ariaLabel: 'Select clef',
                                    title: 'Clef',
                                    hint: 'Which notes the lines stand for.',
                                    anchorRef,
                                    manageFocus: true,
                                    onDismiss,
                                    children: option(),
                                }),
                        ),
                    }),
                )
            })
            trigger = anchorRef.current?.querySelector('button') as HTMLButtonElement
        }

        it('renders into the one sheet host, titled in sentence case, with the hint and a Close button', () => {
            const onDismiss = vi.fn()
            renderSheet(onDismiss)
            const frame = host.querySelector<HTMLElement>('[data-popover-sheet-host]') as HTMLElement
            const sheet = frame.querySelector<HTMLElement>('[role="dialog"]') as HTMLElement
            expect(sheet.getAttribute('aria-label')).toBe('Select clef')
            expect(sheet.className).toContain('bg-surface-container-lowest')
            expect(sheet.className).toContain('popover-sheet-enter')
            // The frame is sized from the measured chrome, never from vh.
            expect(frame.className).toContain('var(--app-header-h')
            expect(frame.className).toContain('var(--dock-h')
            expect(frame.className).not.toMatch(/\dvh/)
            expect(sheet.querySelector('h2')?.textContent).toBe('Clef')
            expect(sheet.textContent).toContain('Which notes the lines stand for.')
            const close = sheet.querySelector<HTMLButtonElement>('button[aria-label="Close"]') as HTMLButtonElement
            expect(close.className).toContain('size-10')
            // Icon-only, so it wears a tooltip: a touch hold names it.
            expect(close.parentElement?.className).toContain('[-webkit-touch-callout:none]')
            act(() => close.click())
            expect(onDismiss).toHaveBeenCalledTimes(1)
        })

        it('fades the top edge once the body is scrolled, and not before', () => {
            renderSheet(vi.fn())
            const body = host.querySelector<HTMLElement>('[data-popover-body]') as HTMLElement
            const topFade = () => host.querySelector('[data-sheet-fade="top"]')
            expect(topFade()).toBeNull()
            act(() => {
                body.scrollTop = 40
                body.dispatchEvent(new Event('scroll'))
            })
            expect(topFade()).not.toBeNull()
            act(() => {
                body.scrollTop = 0
                body.dispatchEvent(new Event('scroll'))
            })
            expect(topFade()).toBeNull()
        })

        it('focuses the first option, not Close, and hands focus back to the trigger on close', () => {
            renderSheet(vi.fn())
            expect(document.activeElement?.textContent).toBe('Treble')
            renderSheet(vi.fn(), false)
            expect(document.activeElement).toBe(trigger)
        })

        it('without a host, still portals out of the chrome into <body>', () => {
            act(() => {
                root.render(
                    createElement(Popover, {
                        variant: 'sheet',
                        ariaLabel: 'Set tempo',
                        title: 'Tempo',
                        onDismiss: vi.fn(),
                        children: option(),
                    }),
                )
            })
            expect(host.querySelector('[role="dialog"]')).toBeNull()
            expect(document.body.querySelector('body > div > [role="dialog"][aria-label="Set tempo"]')).not.toBeNull()
        })
    })
})

describe('usePickConfirmation', () => {
    let host: HTMLElement
    let root: Root
    let confirm: () => void

    function Probe({ dismiss, enabled }: { dismiss: () => void; enabled: boolean }) {
        confirm = usePickConfirmation(dismiss, enabled)
        return null
    }

    beforeEach(() => {
        vi.useFakeTimers()
        host = document.createElement('div')
        document.body.appendChild(host)
        root = createRoot(host)
    })

    afterEach(() => {
        act(() => root.unmount())
        host.remove()
        vi.unstubAllGlobals()
        vi.useRealTimers()
    })

    it('holds a sheet open for 150ms after a pick, so the choice shows before it closes', () => {
        const dismiss = vi.fn()
        act(() => root.render(createElement(Probe, { dismiss, enabled: true })))
        confirm()
        vi.advanceTimersByTime(SHEET_PICK_CONFIRM_MS - 1)
        expect(dismiss).not.toHaveBeenCalled()
        vi.advanceTimersByTime(1)
        expect(dismiss).toHaveBeenCalledTimes(1)
    })

    it('closes at once for anchored popovers and under reduced motion', () => {
        const dismiss = vi.fn()
        act(() => root.render(createElement(Probe, { dismiss, enabled: false })))
        confirm()
        expect(dismiss).toHaveBeenCalledTimes(1)

        vi.stubGlobal('matchMedia', (query: string) => ({ matches: query.includes('reduce') }))
        act(() => root.render(createElement(Probe, { dismiss, enabled: true })))
        confirm()
        expect(dismiss).toHaveBeenCalledTimes(2)
    })
})
