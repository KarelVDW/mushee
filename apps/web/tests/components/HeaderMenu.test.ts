import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { HeaderMenu } from '@/components/ui/HeaderMenu'

// React's act() refuses to run outside a test-aware environment.
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

describe('HeaderMenu', () => {
    let host: HTMLElement
    let root: Root
    let outside: HTMLButtonElement

    const chip = () => host.querySelector<HTMLButtonElement>('button[aria-label="Export score"]') as HTMLButtonElement
    const panel = () => host.querySelector<HTMLElement>('[role="dialog"]')

    function render(children: Parameters<typeof HeaderMenu>[0]['children'], props: Partial<Parameters<typeof HeaderMenu>[0]> = {}) {
        act(() => {
            root.render(
                createElement(HeaderMenu, {
                    icon: 'download',
                    label: 'Export',
                    ariaLabel: 'Export score',
                    title: 'Export as',
                    ...props,
                    children,
                }),
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
        expect(document.activeElement?.textContent).toBe('MusicXML')
    })

    it('announces itself as a menu trigger, collapsed or expanded — not as a toggle', () => {
        render(createElement('button', { type: 'button' }, 'MusicXML'))
        expect(chip().getAttribute('aria-haspopup')).toBe('dialog')
        expect(chip().getAttribute('aria-expanded')).toBe('false')
        expect(chip().hasAttribute('aria-pressed')).toBe(false)
        act(() => chip().click())
        expect(chip().getAttribute('aria-expanded')).toBe('true')
    })

    it('opens an opaque panel, never glass over the staff', () => {
        render(createElement('button', { type: 'button' }, 'MusicXML'))
        act(() => chip().click())
        expect(panel()?.className).toContain('bg-surface-container-lowest')
        expect(panel()?.className).not.toContain('glass-panel')
    })

    it('shows the visible label, or only the icon when compact or unlabelled', () => {
        render(createElement('span', null, 'x'), { label: 'Download', ariaLabel: 'Download score' })
        expect(host.querySelector('button[aria-label="Download score"]')?.textContent).toBe('Download')
        // Labelled chips need no tooltip: their text is the name.
        expect(host.querySelector('[role="tooltip"]')).toBeNull()

        render(createElement('span', null, 'x'), { compact: true, tooltipHint: 'PDF, MusicXML or MIDI' })
        expect(chip().textContent).toBe('')
        const description = document.getElementById(chip().getAttribute('aria-describedby') as string)
        expect(description?.textContent).toBe('PDF, MusicXML or MIDI')

        render(createElement('span', null, 'x'), { label: undefined })
        expect(chip().textContent).toBe('')
    })

    it('keeps a panel that would spill off the left edge 16px inside the viewport', () => {
        const rect = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
            const shifted = Number(/translateX\((-?[\d.]+)px\)/.exec(this.style.transform)?.[1] ?? 0)
            // A 320px panel right-aligned under a chip whose right edge sits at x = 200.
            return { left: -120 + shifted, right: 200 + shifted, width: 320, top: 0, bottom: 100, height: 100, x: 0, y: 0 } as DOMRect
        })
        render(createElement('button', { type: 'button' }, 'MusicXML'))
        act(() => chip().click())
        expect(panel()?.style.transform).toBe('translateX(136px)')
        rect.mockRestore()
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

    it('an open chip turns a tone darker, never cyan', () => {
        render(createElement('button', { type: 'button' }, 'MusicXML'))
        act(() => chip().click())
        expect(chip().className).toContain('bg-surface-container-high')
        expect(chip().className).not.toContain('bg-primary-container')
    })

    it('titles its panel in sentence case, never an eyebrow', () => {
        render(createElement('button', { type: 'button' }, 'MusicXML'))
        act(() => chip().click())
        const heading = panel()?.querySelector('h2') as HTMLElement
        expect(heading.textContent).toBe('Export as')
        expect(heading.className).toContain('type-label')
        expect(heading.className).not.toContain('uppercase')
    })

    it('an icon-only chip is a circle; a labelled one keeps its pill; lg is the 44px size', () => {
        render(createElement('span', null, 'x'), { compact: true })
        expect(chip().className).toContain('size-(--control-sm) p-0')
        expect(chip().querySelectorAll('svg')).toHaveLength(2)
        render(createElement('span', null, 'x'))
        expect(chip().className).toContain('h-(--control-sm) px-3.5')
        render(createElement('span', null, 'x'), { size: 'lg' })
        expect(chip().className).toContain('h-11 px-5')
        expect(chip().className).toContain('text-[14px]')
    })

    describe('sheet', () => {
        const sheet = () => document.body.querySelector<HTMLElement>('[role="dialog"][aria-label="Export score"]')

        it('opens a full-width card under the header, titled at the sheet size with a 40px Close', () => {
            render(createElement('button', { type: 'button' }, 'MusicXML'), { sheet: true, compact: true, className: 'gap-2 w-80' })
            act(() => chip().click())
            const card = sheet() as HTMLElement
            expect(card).not.toBeNull()
            // Out of the header's subtree, into <body>.
            expect(host.contains(card)).toBe(false)
            expect(card.className).toContain('fixed inset-x-2 top-[calc(var(--app-header-h,0px)+0.5rem)]')
            expect(card.className).toContain('rounded-xl')
            expect(card.className).toContain('shadow-overlay')
            expect(card.className).toContain('popover-enter')
            expect(card.style.getPropertyValue('--pop-from')).toBe('-6px')
            // The panel's widths stay off the card; only the content gap is kept.
            expect(card.className).not.toContain('w-80')
            expect(card.querySelector('[data-popover-body] > div')?.className).toContain('gap-2')
            const heading = card.querySelector('h2') as HTMLElement
            expect(heading.textContent).toBe('Export as')
            expect(heading.className).toContain('text-[20px]')
            expect(document.activeElement?.textContent).toBe('MusicXML')
            const closeButton = card.querySelector<HTMLButtonElement>('button[aria-label="Close"]') as HTMLButtonElement
            expect(closeButton.className).toContain('size-10')
            act(() => closeButton.click())
            expect(sheet()).toBeNull()
            expect(document.activeElement).toBe(chip())
        })

        it('closes on Escape, handing focus back to the chip', () => {
            render(createElement('button', { type: 'button' }, 'MusicXML'), { sheet: true })
            act(() => chip().click())
            pressEscape()
            expect(sheet()).toBeNull()
            expect(document.activeElement).toBe(chip())
        })
    })

    it('hands a render-prop child the close callback', () => {
        render(({ close }) => createElement('button', { type: 'button', onClick: close }, 'Done'))
        act(() => chip().click())
        act(() => (document.activeElement as HTMLButtonElement).click())
        expect(panel()).toBeNull()
        expect(document.activeElement).toBe(chip())
    })
})
