import { act, createElement, useState } from 'react'
import { createRoot, hydrateRoot, type Root } from 'react-dom/client'
import { renderToStaticMarkup, renderToString } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
    focusWithoutTooltip,
    shortcutText,
    Tooltip,
    TOOLTIP_HOLD_DELAY_MS,
    TOOLTIP_HOLD_LINGER_MS,
    TOOLTIP_HOVER_DELAY_MS,
    TooltipCard,
} from '@/components/ui/Tooltip'
import { Shortcut } from '@/lib/Keybindings'

// React's act() refuses to run outside a test-aware environment.
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

/** The visible card or bubble (portalled to <body>, decorative for assistive tech). */
const card = () => document.body.querySelector<HTMLElement>('body > [aria-hidden="true"].tooltip-enter')

/** Run the fake clock forward inside act, so timer-driven state lands before the next assertion. */
function advance(ms: number) {
    act(() => {
        vi.advanceTimersByTime(ms)
    })
}

function pointer(target: EventTarget, type: string, init: PointerEventInit = {}) {
    act(() => {
        target.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, pointerType: 'mouse', ...init }))
    })
}

describe('Tooltip', () => {
    let host: HTMLElement
    let outside: HTMLElement
    let root: Root
    let onClick: ReturnType<typeof vi.fn>
    let focusVisible: boolean
    // Kept unbound on purpose: the mock below calls it with the element as `this`.
    // eslint-disable-next-line @typescript-eslint/unbound-method
    const originalMatches = Element.prototype.matches

    const button = () => host.querySelector('button') as HTMLButtonElement

    /** Keyboard focus: a Tab press (heard on the window), then focus landing on the control. */
    const keyFocus = () =>
        act(() => {
            window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab' }))
            button().focus()
        })

    /** Report `(pointer: coarse)` as matching — a phone. */
    function coarsePointer() {
        vi.spyOn(window, 'matchMedia').mockImplementation(
            (query: string) =>
                ({
                    matches: query === '(pointer: coarse)',
                    media: query,
                    addEventListener: () => undefined,
                    removeEventListener: () => undefined,
                }) as unknown as MediaQueryList,
        )
    }

    function render(props: Partial<Parameters<typeof Tooltip>[0]> = {}, buttonProps: Record<string, unknown> = {}) {
        act(() => {
            root.render(
                createElement(Tooltip, {
                    label: 'Quarter note',
                    hint: '1 beat',
                    shortcut: ['Q'],
                    ...props,
                    children: createElement('button', { type: 'button', 'aria-label': 'Quarter note', onClick, ...buttonProps }, '♩'),
                }),
            )
        })
    }

    beforeEach(() => {
        vi.useFakeTimers()
        focusVisible = true
        vi.spyOn(Element.prototype, 'matches').mockImplementation(function (this: Element, selector: string) {
            return selector === ':focus-visible' ? focusVisible : originalMatches.call(this, selector)
        })
        onClick = vi.fn()
        // Every test starts from a pointer press: only a key press makes focus open a tooltip.
        pointer(document.body, 'pointerdown')
        host = document.createElement('div')
        outside = document.createElement('div')
        document.body.append(host, outside)
        root = createRoot(host)
    })

    afterEach(() => {
        act(() => root.unmount())
        host.remove()
        outside.remove()
        vi.restoreAllMocks()
        vi.useRealTimers()
    })

    it('opens after 400ms of mouse hover and closes when the pointer leaves', () => {
        render()
        pointer(button(), 'pointerover')
        advance(TOOLTIP_HOVER_DELAY_MS - 1)
        expect(card()).toBeNull()
        advance(1)
        expect(card()?.textContent).toBe('Quarter note — 1 beat · Q')
        expect(card()?.className).toContain('bg-surface-container-lowest')
        pointer(button(), 'pointerout', { relatedTarget: outside })
        expect(card()).toBeNull()
    })

    it('never opens from a touch hover, and a mouse press closes it', () => {
        render()
        pointer(button(), 'pointerover', { pointerType: 'touch' })
        advance(TOOLTIP_HOVER_DELAY_MS)
        expect(card()).toBeNull()

        pointer(button(), 'pointerover')
        advance(TOOLTIP_HOVER_DELAY_MS)
        expect(card()).not.toBeNull()
        pointer(button(), 'pointerdown')
        expect(card()).toBeNull()
    })

    it('opens at once on keyboard focus, closes on blur', () => {
        render()
        keyFocus()
        expect(card()?.textContent).toBe('Quarter note — 1 beat · Q')
        act(() => button().blur())
        expect(card()).toBeNull()
    })

    it('stays shut for focus that is not :focus-visible, or handed back by a popover', () => {
        render()
        focusVisible = false
        keyFocus()
        expect(card()).toBeNull()
        act(() => button().blur())

        focusVisible = true
        act(() => focusWithoutTooltip(button()))
        expect(document.activeElement).toBe(button())
        expect(card()).toBeNull()
    })

    it('stays shut for focus the app moves after a tap, even when the browser calls it focus-visible', () => {
        render()
        // A phone after a recording: the user tapped Stop, the editor moves focus to the record button.
        pointer(document.body, 'pointerdown', { pointerType: 'touch' })
        act(() => button().focus())
        expect(card()).toBeNull()
        act(() => button().blur())
        // Moved with focusWithoutTooltip, it stays shut even straight after a key press (Space stopped the recording).
        act(() => {
            document.body.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }))
            focusWithoutTooltip(button(), { preventScroll: true })
        })
        expect(document.activeElement).toBe(button())
        expect(card()).toBeNull()
    })

    it('never names the key on a coarse pointer — not in the bubble, the card or the description', () => {
        coarsePointer()
        render()
        const description = () => document.getElementById(button().getAttribute('aria-describedby') as string)
        expect(description()?.textContent).toBe('1 beat')
        // A phone with a keyboard attached still gets the name, without the key.
        keyFocus()
        expect(card()?.textContent).toBe('Quarter note — 1 beat')
        act(() => button().blur())
        // A shortcut-only tooltip (no hint) leaves no description at all.
        render({ hint: undefined })
        expect(button().hasAttribute('aria-describedby')).toBe(false)
    })

    it('closes when the control is used from the keyboard, Enter or Space', () => {
        render()
        keyFocus()
        expect(card()).not.toBeNull()
        // Enter on a focused button: keydown, then the click it activates (detail 0, no pointer).
        act(() => {
            button().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))
            button().click()
        })
        expect(onClick).toHaveBeenCalledTimes(1)
        expect(card()).toBeNull()
        expect(document.activeElement).toBe(button())
    })

    it('inside a modal dialog, Escape closes the tooltip and still reaches the dialog', () => {
        const dialogKeys: string[] = []
        const onDocumentKey = (e: KeyboardEvent) => dialogKeys.push(e.key)
        document.addEventListener('keydown', onDocumentKey)
        host.setAttribute('aria-modal', 'true')
        try {
            render()
            keyFocus()
            const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
            act(() => {
                button().dispatchEvent(event)
            })
            expect(card()).toBeNull()
            expect(event.defaultPrevented).toBe(false)
            expect(dialogKeys).toEqual(['Escape'])
        } finally {
            document.removeEventListener('keydown', onDocumentKey)
            host.removeAttribute('aria-modal')
        }
    })

    it('consumes Escape: the tooltip closes and the editor never sees the key', () => {
        const editorKeys: string[] = []
        host.addEventListener('keydown', (e) => editorKeys.push(e.key))
        render()
        keyFocus()
        const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
        act(() => {
            button().dispatchEvent(event)
        })
        expect(card()).toBeNull()
        expect(event.defaultPrevented).toBe(true)
        expect(editorKeys).toEqual([])
        // Closed, it lets Escape through again.
        act(() => {
            button().dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
        })
        expect(editorKeys).toEqual(['Escape'])
    })

    it('describes the trigger with the hint and key through a hidden role=tooltip element', () => {
        render()
        const id = button().getAttribute('aria-describedby')
        expect(id).toBeTruthy()
        const description = document.getElementById(id as string) as HTMLElement
        expect(description.getAttribute('role')).toBe('tooltip')
        expect(description.hidden).toBe(true)
        // The name stays the aria-label; the description carries only what it adds.
        expect(description.textContent).toBe('1 beat, Q')
        expect(button().getAttribute('aria-label')).toBe('Quarter note')
    })

    it('leaves a name-only tooltip undescribed, and renders a bare control when given nothing', () => {
        render({ hint: undefined, shortcut: null })
        expect(button().hasAttribute('aria-describedby')).toBe(false)
        expect(host.querySelector('[role="tooltip"]')).toBeNull()

        render({ label: undefined, hint: undefined, shortcut: undefined })
        expect(host.firstElementChild).toBe(button())
    })

    it('a reason replaces name, hint and key, and is the description', () => {
        render({ label: 'Tie', reason: 'Tie needs the next note to be the same pitch.' })
        keyFocus()
        expect(card()?.textContent).toBe('Tie needs the next note to be the same pitch.')
        const description = document.getElementById(button().getAttribute('aria-describedby') as string)
        expect(description?.textContent).toBe('Tie needs the next note to be the same pitch.')
    })

    it('shows on hover over a natively disabled control, through its wrapper', () => {
        render({}, { disabled: true })
        const wrapper = button().parentElement as HTMLElement
        expect(wrapper.className).toContain('[&_:disabled]:pointer-events-none')
        pointer(wrapper, 'pointerover')
        advance(TOOLTIP_HOVER_DELAY_MS)
        expect(card()?.textContent).toContain('Quarter note')
    })

    describe('on a control that opens a panel (aria-expanded)', () => {
        /** A popover chip: a press toggles its panel and aria-expanded with it. */
        function PopupChip() {
            const [expanded, setExpanded] = useState(false)
            return createElement(
                'button',
                {
                    type: 'button',
                    'aria-label': 'Clef',
                    'aria-haspopup': 'dialog',
                    'aria-expanded': expanded,
                    onClick: () => setExpanded((v) => !v),
                },
                '𝄞',
            )
        }
        const renderChip = () =>
            act(() => {
                root.render(createElement(Tooltip, { label: 'Clef', hint: 'Treble', children: createElement(PopupChip) }))
            })

        it('a touch hold that opens the panel takes its bubble down at once, not after the linger', async () => {
            renderChip()
            pointer(button(), 'pointerdown', { pointerType: 'touch', clientX: 10, clientY: 10 })
            advance(TOOLTIP_HOLD_DELAY_MS)
            expect(card()).not.toBeNull()
            pointer(button(), 'pointerup', { pointerType: 'touch', clientX: 10, clientY: 10 })
            await act(async () => {
                button().click()
                await Promise.resolve()
            })
            expect(button().getAttribute('aria-expanded')).toBe('true')
            expect(card()).toBeNull()
        })

        it('stays shut over an open panel, on hover and on keyboard focus', () => {
            renderChip()
            act(() => button().click())
            expect(button().getAttribute('aria-expanded')).toBe('true')
            pointer(button(), 'pointerover')
            advance(TOOLTIP_HOVER_DELAY_MS)
            expect(card()).toBeNull()
            keyFocus()
            expect(card()).toBeNull()
            pointer(button(), 'pointerdown', { pointerType: 'touch' })
            advance(TOOLTIP_HOLD_DELAY_MS)
            expect(card()).toBeNull()
        })
    })

    describe('press-and-hold on touch', () => {
        it('names the control after 450ms, without the key, and the release still acts', () => {
            render()
            pointer(button(), 'pointerdown', { pointerType: 'touch', clientX: 10, clientY: 10 })
            advance(TOOLTIP_HOLD_DELAY_MS - 1)
            expect(card()).toBeNull()
            advance(1)
            expect(card()?.textContent).toBe('Quarter note — 1 beat')
            expect(card()?.className).toContain('rounded-full')

            pointer(button(), 'pointerup', { pointerType: 'touch', clientX: 10, clientY: 10 })
            act(() => button().click())
            expect(onClick).toHaveBeenCalledTimes(1)
            // Kept for a moment after the finger lifts, then gone.
            advance(TOOLTIP_HOLD_LINGER_MS - 1)
            expect(card()).not.toBeNull()
            advance(1)
            expect(card()).toBeNull()
        })

        it('a quick tap shows nothing and acts', () => {
            render()
            pointer(button(), 'pointerdown', { pointerType: 'touch' })
            advance(100)
            pointer(button(), 'pointerup', { pointerType: 'touch' })
            act(() => button().click())
            advance(TOOLTIP_HOLD_DELAY_MS)
            expect(card()).toBeNull()
            expect(onClick).toHaveBeenCalledTimes(1)
        })

        it('sliding off before release cancels both the bubble and the action', () => {
            render()
            pointer(button(), 'pointerdown', { pointerType: 'touch', clientX: 10, clientY: 10 })
            advance(TOOLTIP_HOLD_DELAY_MS)
            expect(card()).not.toBeNull()
            pointer(button(), 'pointermove', { pointerType: 'touch', clientX: 10, clientY: 25 })
            expect(card()).toBeNull()
            pointer(button(), 'pointerup', { pointerType: 'touch', clientX: 10, clientY: 25 })
            act(() => button().click())
            expect(onClick).not.toHaveBeenCalled()
            // The next tap acts again.
            pointer(button(), 'pointerdown', { pointerType: 'touch' })
            pointer(button(), 'pointerup', { pointerType: 'touch' })
            act(() => button().click())
            expect(onClick).toHaveBeenCalledTimes(1)
        })

        it('keeps the context menu and callout away while held', () => {
            render()
            pointer(button(), 'pointerdown', { pointerType: 'touch' })
            const menu = new MouseEvent('contextmenu', { bubbles: true, cancelable: true })
            act(() => {
                button().dispatchEvent(menu)
            })
            expect(menu.defaultPrevented).toBe(true)
            expect((button().parentElement as HTMLElement).className).toContain('[-webkit-touch-callout:none]')
        })
    })
})

describe('Tooltip server rendering', () => {
    afterEach(() => {
        vi.restoreAllMocks()
    })

    it('renders the key the same on server and client, then names it the Apple way after hydration', async () => {
        vi.spyOn(navigator, 'platform', 'get').mockReturnValue('MacIntel')
        const redo = Shortcut.parse('Mod+Shift+KeyZ', true)
        const tooltip = () =>
            createElement(Tooltip, {
                label: 'Redo',
                shortcut: redo,
                children: createElement('button', { type: 'button', 'aria-label': 'Redo' }, '↷'),
            })
        const container = document.createElement('div')
        container.innerHTML = renderToString(tooltip())
        document.body.append(container)
        // The server can't know the platform: it names the key the non-Apple way.
        expect(container.querySelector('[role="tooltip"]')?.textContent).toBe(shortcutText(redo, false))

        const hydrationErrors: unknown[] = []
        let root: Root | undefined
        await act(async () => {
            root = hydrateRoot(container, tooltip(), { onRecoverableError: (error) => hydrationErrors.push(error) })
            await Promise.resolve()
        })
        expect(hydrationErrors).toEqual([])
        expect(container.querySelector('[role="tooltip"]')?.textContent).toBe('⇧⌘Z')
        act(() => root?.unmount())
        container.remove()
    })
})

describe('shortcutText', () => {
    it('renders per platform: ⇧⌘Z on Apple, Ctrl+Shift+Z elsewhere', () => {
        expect(shortcutText(Shortcut.parse('Mod+Shift+KeyZ', true), true)).toBe('⇧⌘Z')
        expect(shortcutText(Shortcut.parse('Mod+Shift+KeyZ', false), false)).toBe('Ctrl+Shift+Z')
        expect(shortcutText(Shortcut.parse('KeyQ', false), false)).toBe('Q')
    })

    it("names the key through the browser's layout map, like the shortcuts dialog", () => {
        const azerty = new Map([
            ['KeyQ', 'a'],
            ['Period', ':'],
        ])
        expect(shortcutText(Shortcut.parse('KeyQ', false), false, azerty)).toBe('A')
        expect(shortcutText(Shortcut.parse('Period', false), false, azerty)).toBe(':')
        // No map at all: the punctuation still reads as a character, not 'Period'.
        expect(shortcutText(Shortcut.parse('Period', false), false, null)).toBe('.')
    })

    it('takes resolved display tokens as they are, and nothing for an unbound command', () => {
        expect(shortcutText(['⇧', 'R'], true)).toBe('⇧R')
        expect(shortcutText(['Ctrl', 'Z'], false)).toBe('Ctrl+Z')
        expect(shortcutText(null)).toBeNull()
        expect(shortcutText(undefined)).toBeNull()
        expect(shortcutText([])).toBeNull()
    })
})

describe('TooltipCard', () => {
    const markup = (props: Parameters<typeof TooltipCard>[0]) => renderToStaticMarkup(createElement(TooltipCard, props))

    it('draws "Name — hint · key" on the opaque card, decorative for assistive tech', () => {
        const html = markup({ label: 'Quarter note', hint: '1 beat', keys: 'Q' })
        expect(html).toMatch(/^<span aria-hidden="true" class="tooltip-enter [^"]*rounded-md bg-surface-container-lowest shadow-overlay/)
        expect(html).toContain('<span class="font-label font-semibold">Quarter note</span>')
        expect(html).toContain('<span class="text-on-surface-variant"> — </span><span class="text-on-surface-variant">1 beat</span>')
        expect(html).toContain('>Q</kbd>')
    })

    it('takes positioning from the caller and keeps its own look', () => {
        const html = markup({ label: 'Change key', className: 'absolute -translate-y-full', style: { left: 12, top: 4 } })
        expect(html).toContain('class="tooltip-enter absolute -translate-y-full pointer-events-none')
        expect(html).toContain('style="left:12px;top:4px"')
        expect(html).not.toContain('<kbd')
    })

    it('renders the touch bubble as a pill without the key', () => {
        const html = markup({ label: 'Record', hint: 'Start a recording', keys: '⇧R', touch: true })
        expect(html).toContain('rounded-full bg-surface-container-high')
        expect(html).toContain(' — Start a recording')
        expect(html).not.toContain('⇧R')
    })
})
