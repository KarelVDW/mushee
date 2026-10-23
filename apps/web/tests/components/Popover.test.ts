import { act, createElement, StrictMode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
    inferOptionLayout,
    Popover,
    PopoverOption,
    PopoverSheetHost,
    SHEET_PICK_CONFIRM_MS,
    usePickConfirmation,
} from '@/components/ui/Popover'

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

    it('anchored: an opaque card with a plain title and the one-line hint under it', () => {
        act(() => {
            root.render(
                createElement(Popover, {
                    ariaLabel: 'Select clef',
                    title: 'Clef',
                    hint: 'Which notes the lines stand for.',
                    onDismiss: vi.fn(),
                    className: 'w-80 gap-2 right-0 top-full',
                    children: option(),
                }),
            )
        })
        const panel = host.querySelector<HTMLElement>('[role="dialog"]') as HTMLElement
        expect(panel.className).toContain('bg-surface-container-lowest')
        expect(panel.className).toContain('shadow-overlay')
        expect(panel.className).not.toContain('glass-panel')
        // It arrives from its anchor (the entrance animates `translate`, never `transform`).
        expect(panel.className).toContain('popover-enter')
        const [header, content] = Array.from(panel.children) as HTMLElement[]
        // The title is a sentence-case h2 — no eyebrow — and the hint sits under it.
        const title = header.querySelector('h2') as HTMLElement
        expect(title.textContent).toBe('Clef')
        expect(title.className).toContain('type-label')
        expect(header.querySelector('span')).toBeNull()
        const hint = header.querySelector('p') as HTMLElement
        expect(hint.textContent).toBe('Which notes the lines stand for.')
        expect(hint.className).toContain('text-[13px]')
        // The content starts 12px under the heading; the call site's gap spaces the content only.
        expect(header.className).toContain('mb-3')
        expect(content.className).toContain('gap-2')
        expect(panel.className).not.toContain('gap-2')
        expect(panel.className).toContain('w-80')
        expect(content.textContent).toBe('Treble')
    })

    it('anchored: travels in from the side it opened on', () => {
        const anchorRef = { current: document.createElement('div') }
        document.body.appendChild(anchorRef.current)
        const rect = (top: number, bottom: number) => ({ top, bottom, left: 0, right: 100, width: 100, height: bottom - top }) as DOMRect
        vi.spyOn(anchorRef.current, 'getBoundingClientRect').mockReturnValue(rect(500, 540))
        const panelRect = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect')
        const render = () =>
            act(() =>
                root.render(createElement(Popover, { ariaLabel: 'More', title: 'More', onDismiss: vi.fn(), anchorRef, children: option() })),
            )
        // Above the chip (the dock): it rises the last 6px.
        panelRect.mockReturnValue(rect(300, 488))
        render()
        const panel = () => host.querySelector<HTMLElement>('[role="dialog"]') as HTMLElement
        expect(panel().style.getPropertyValue('--pop-from')).toBe('6px')
        act(() => root.render(null))
        // Below the chip (the header): it drops the last 6px.
        panelRect.mockReturnValue(rect(548, 700))
        render()
        expect(panel().style.getPropertyValue('--pop-from')).toBe('-6px')
        panelRect.mockRestore()
        anchorRef.current.remove()
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

        it('heads the sheet with a 20px title, the hint 4px under it and content 12px below', () => {
            renderSheet(vi.fn())
            const sheet = host.querySelector<HTMLElement>('[role="dialog"]') as HTMLElement
            const header = sheet.querySelector<HTMLElement>('[data-popover-header]') as HTMLElement
            expect(header.className).toContain('pb-3')
            expect(header.querySelector('h2')?.className).toContain('text-[20px]')
            expect(header.querySelector('p')?.className).toContain('mt-1')
        })

        it('leaves an inert, role-less copy behind on a full close, which fades out and goes', () => {
            vi.useFakeTimers()
            renderSheet(vi.fn())
            renderSheet(vi.fn(), false)
            const frame = host.querySelector<HTMLElement>('[data-popover-sheet-host]') as HTMLElement
            expect(frame.querySelectorAll('[role="dialog"]')).toHaveLength(0)
            const ghost = frame.querySelector<HTMLElement>('[data-popover-sheet-leaving]') as HTMLElement
            expect(ghost).not.toBeNull()
            expect(ghost.getAttribute('aria-hidden')).toBe('true')
            expect(ghost.hasAttribute('inert')).toBe(true)
            expect(ghost.hasAttribute('aria-label')).toBe(false)
            expect(ghost.querySelector('[id]')).toBeNull()
            expect(ghost.className).toContain('animate-sheet-out')
            expect(ghost.className).toContain('pointer-events-none')
            expect(ghost.className).not.toContain('popover-sheet-enter')
            // Gone once its exit has played.
            act(() => ghost.dispatchEvent(new Event('animationend')))
            expect(frame.querySelector('[data-popover-sheet-leaving]')).toBeNull()
            // And, should animationend never come, shortly after anyway.
            renderSheet(vi.fn())
            renderSheet(vi.fn(), false)
            expect(frame.querySelector('[data-popover-sheet-leaving]')).not.toBeNull()
            act(() => vi.advanceTimersByTime(400))
            expect(frame.querySelector('[data-popover-sheet-leaving]')).toBeNull()
            vi.useRealTimers()
        })

        it('shows no exit when one sheet replaces another in the same commit', () => {
            const sheetOf = (title: string) =>
                createElement(Popover, { variant: 'sheet', ariaLabel: title, title, onDismiss: vi.fn(), children: option() })
            act(() => root.render(createElement(PopoverSheetHost, { children: sheetOf('More tools') })))
            act(() =>
                root.render(
                    createElement(PopoverSheetHost, {
                        children: createElement(Popover, {
                            variant: 'sheet',
                            ariaLabel: 'Select clef',
                            title: 'Clef',
                            lead: createElement('button', { type: 'button' }, 'Back'),
                            onDismiss: vi.fn(),
                            children: option(),
                        }),
                    }),
                ),
            )
            const frame = host.querySelector<HTMLElement>('[data-popover-sheet-host]') as HTMLElement
            expect(frame.querySelector('[data-popover-sheet-leaving]')).toBeNull()
            expect([...frame.querySelectorAll('[role="dialog"]')].map((d) => d.getAttribute('aria-label'))).toEqual(['Select clef'])
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

describe('PopoverOption', () => {
    const markup = (props: Partial<Parameters<typeof PopoverOption>[0]> = {}) =>
        renderToStaticMarkup(
            createElement(PopoverOption, { active: false, onClick: () => undefined, ariaLabel: 'Set Treble clef', children: 'Treble', ...props }),
        )
    const button = (props: Partial<Parameters<typeof PopoverOption>[0]> = {}) => {
        const box = document.createElement('div')
        box.innerHTML = markup(props)
        return box.querySelector('button') as HTMLButtonElement
    }

    it('rests on the tile fill and, picked, takes the selected fill — never the loud primary', () => {
        const rest = button()
        expect(rest.getAttribute('aria-pressed')).toBe('false')
        expect(rest.className).toContain('bg-(--tile-fill)')
        expect(rest.className).toContain('hover:bg-(--tile-fill-hover)')
        expect(rest.className).toContain('active:bg-(--tile-fill-press)')
        const picked = button({ active: true })
        expect(picked.getAttribute('aria-pressed')).toBe('true')
        expect(picked.className).toContain('bg-(--color-selected) text-(--color-on-selected)')
        expect(picked.className).not.toContain('bg-primary-container')
    })

    it('reads its layout off its size classes', () => {
        expect(inferOptionLayout('w-full h-14 gap-3 px-3 text-left')).toBe('row')
        expect(inferOptionLayout('flex-col justify-center gap-1 w-18 h-18 px-1')).toBe('tile')
        expect(inferOptionLayout('flex-col justify-center gap-1 w-23 h-19 px-1')).toBe('tile')
        expect(inferOptionLayout('flex-col justify-end gap-0.5 w-12 h-14 px-1 py-1.5')).toBe('cell')
        expect(inferOptionLayout('flex-col justify-end gap-0.5 w-full min-w-0 h-12 px-0.5 py-1')).toBe('cell')
        expect(inferOptionLayout('justify-center w-full min-w-0 h-10 text-[13px] font-medium')).toBe('cell')
        expect(inferOptionLayout('justify-center px-3 h-10 text-[13px] font-medium')).toBe('cell')
    })

    it('shows a picked row by a trailing mark, a tile by a corner mark, a cell by a check by its label', () => {
        const mark = (el: Element) => el.querySelector('[aria-hidden="true"]') as HTMLElement | null
        const row = button({ active: true, className: 'w-full h-14 gap-3 px-3 text-left' })
        expect(mark(row)?.className).toContain('ml-auto')
        expect(mark(button({ className: 'w-full h-14 gap-3 px-3 text-left' }))).toBeNull()

        const tile = button({ active: true, className: 'flex-col justify-center gap-1 w-18 h-18 px-1' })
        expect(tile.className).toContain('relative')
        expect(mark(tile)?.className).toContain('absolute top-1 right-1')
        expect(mark(tile)?.className).toContain('size-3.5')

        // A lone label: the check follows it.
        const quality = button({ active: true, className: 'justify-center px-3 h-10', children: 'Major' })
        expect(quality.textContent).toBe('Major')
        expect(quality.lastElementChild?.querySelector('svg')).not.toBeNull()

        // A glyph over its label: the check leads the label's line, clear of the glyph.
        const key = button({
            active: true,
            className: 'flex-col justify-end gap-0.5 w-12 h-14',
            children: [createElement('span', { key: 'g', 'data-glyph': '' }), createElement('span', { key: 'l' }, 'C')],
        })
        const [glyph, line] = Array.from(key.children)
        expect(glyph.hasAttribute('data-glyph')).toBe(true)
        expect(line.firstElementChild?.getAttribute('aria-hidden')).toBe('true')
        expect(line.textContent).toBe('C')
    })

    it('shrinks a little when pressed — cells and tiles only, and only when motion is welcome', () => {
        expect(button({ className: 'justify-center px-3 h-10' }).className).toContain('motion-safe:active:scale-[0.97]')
        expect(button({ className: 'w-full h-14 gap-3 px-3 text-left' }).className).not.toContain('scale-')
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

describe('Popover viewport clamp', () => {
    let host: HTMLElement
    let root: Root
    const innerWidth = window.innerWidth

    /** The inline translateX the panel carries now — what a real layout adds to its box. */
    const shiftOf = (el: HTMLElement) => Number(/translateX\((-?[\d.]+)px\)/.exec(el.style.transform)?.[1] ?? 0)

    beforeEach(() => {
        host = document.createElement('div')
        document.body.appendChild(host)
        root = createRoot(host)
        Object.defineProperty(window, 'innerWidth', { configurable: true, value: 390 })
        // A 320px panel laid out from x = -50 (a right-aligned menu under a chip near the left
        // edge), moved by whatever shift it carries — as the browser would report it.
        vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
            const left = -50 + shiftOf(this)
            return { left, right: left + 320, width: 320, top: 0, bottom: 100, height: 100, x: left, y: 0, toJSON: () => ({}) } as DOMRect
        })
    })

    afterEach(() => {
        act(() => root.unmount())
        host.remove()
        Object.defineProperty(window, 'innerWidth', { configurable: true, value: innerWidth })
        vi.restoreAllMocks()
    })

    it('shifts the panel once, even when StrictMode measures twice before a re-render', () => {
        const popover = createElement(Popover, {
            ariaLabel: 'Share score',
            title: 'Share',
            onDismiss: () => undefined,
            viewportGutter: 16,
            children: null,
        })
        act(() => root.render(createElement(StrictMode, null, popover)))
        const panel = host.querySelector<HTMLElement>('[role="dialog"]')
        if (!panel) throw new Error('expected the panel')
        // 16px in from the left edge: 16 - (-50), never twice that.
        expect(panel.style.transform).toBe('translateX(66px)')

        // Measuring the shifted panel again (a resize) keeps the one shift.
        act(() => {
            window.dispatchEvent(new Event('resize'))
        })
        expect(panel.style.transform).toBe('translateX(66px)')
    })
})
