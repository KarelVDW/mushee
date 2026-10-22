import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ChipToggle, Segmented, TransportBtn } from '@/components/ui/Controls'

// React's act() refuses to run outside a test-aware environment.
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const html = (el: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(el)
const noop = () => {}

describe('Segmented', () => {
    const accidentals = [
        { value: 'flat', label: '♭', ariaLabel: 'Flat' },
        { value: undefined, label: '♮', ariaLabel: 'Natural' },
        { value: 'sharp', label: '♯', ariaLabel: 'Sharp' },
    ] as const

    it('names glyph-only options', () => {
        const markup = html(createElement(Segmented, { options: [...accidentals], value: 'flat', onChange: noop, ariaLabel: 'Accidental' }))
        expect(markup).toContain('aria-label="Flat"')
        expect(markup).toContain('aria-label="Natural"')
    })

    it('presses nothing for a mixed (null) value — not the option whose value is undefined', () => {
        const mixed = html(createElement(Segmented, { options: [...accidentals], value: null, onChange: noop, ariaLabel: 'Accidental' }))
        expect(mixed).not.toContain('aria-pressed="true"')
        const natural = html(
            createElement(Segmented, { options: [...accidentals], value: undefined, onChange: noop, ariaLabel: 'Accidental' }),
        )
        expect(natural.match(/aria-pressed="true"/g)).toHaveLength(1)
        expect(natural).toMatch(/aria-label="Natural" aria-pressed="true"/)
    })

    it('stays focusable and silent while disabled with a reason', () => {
        const markup = html(
            createElement(Segmented, {
                options: [{ value: 'q', label: '♩', ariaLabel: 'Quarter note' }],
                value: 'q',
                onChange: noop,
                ariaLabel: 'Note duration',
                disabled: true,
                disabledReason: 'Select one note to change its length.',
            }),
        )
        expect(markup).toContain('aria-disabled="true"')
        expect(markup).not.toContain('disabled=""')
        expect(markup).toContain('>Select one note to change its length.</span>')
    })
})

describe('ChipToggle', () => {
    it('is a toggle by default, and a menu trigger in popup mode', () => {
        const toggle = html(createElement(ChipToggle, { active: true, ariaLabel: 'Rest', children: 'Rest' }))
        expect(toggle).toContain('aria-pressed="true"')
        expect(toggle).not.toContain('aria-haspopup')

        const trigger = html(createElement(ChipToggle, { active: false, popup: true, ariaLabel: 'Select clef', children: '𝄞' }))
        expect(trigger).toContain('aria-haspopup="dialog"')
        expect(trigger).toContain('aria-expanded="false"')
        expect(trigger).not.toContain('aria-pressed')
    })

    it('renders bare without tooltip props, and wrapped with them', () => {
        expect(html(createElement(ChipToggle, { ariaLabel: 'Rest', children: 'Rest' }))).toMatch(/^<button/)
        const tipped = html(
            createElement(ChipToggle, { ariaLabel: 'Rest', hint: 'turn this note into silence', shortcut: ['R'], children: 'Rest' }),
        )
        expect(tipped).toMatch(/^<span/)
        expect(tipped).toContain('role="tooltip"')
    })

    describe('disabled', () => {
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

        it('with a reason: aria-disabled, focusable, click ignored, described by the reason', () => {
            const onClick = vi.fn()
            act(() => {
                root.render(
                    createElement(ChipToggle, {
                        ariaLabel: 'Tie',
                        disabled: true,
                        disabledReason: 'Tie needs the next note to be the same pitch.',
                        onClick,
                        children: 'Tie',
                    }),
                )
            })
            const button = host.querySelector('button') as HTMLButtonElement
            expect(button.disabled).toBe(false)
            expect(button.getAttribute('aria-disabled')).toBe('true')
            act(() => button.click())
            expect(onClick).not.toHaveBeenCalled()
            const description = document.getElementById(button.getAttribute('aria-describedby') as string)
            expect(description?.textContent).toBe('Tie needs the next note to be the same pitch.')
            expect(button.className).toContain('opacity-40')
        })

        it('without a reason: natively disabled, as before', () => {
            act(() => root.render(createElement(ChipToggle, { ariaLabel: 'Tie', disabled: true, children: 'Tie' })))
            expect((host.querySelector('button') as HTMLButtonElement).disabled).toBe(true)
        })
    })
})

describe('TransportBtn', () => {
    it('sizes through CSS variables with a 40px floor on coarse pointers', () => {
        const markup = html(createElement(TransportBtn, { size: 36, ariaLabel: 'Stop' }))
        expect(markup).toContain('--transport-size:36px')
        expect(markup).toContain('--transport-size-coarse:40px')
        expect(markup).toContain('pointer-coarse:size-(--transport-size-coarse)')
        expect(html(createElement(TransportBtn, { size: 46, coarseSize: 54, ariaLabel: 'Record', tone: 'record' }))).toContain(
            '--transport-size-coarse:54px',
        )
    })

    it('a toggle (the metronome) exposes aria-pressed and the primary-container on state', () => {
        const on = html(createElement(TransportBtn, { size: 36, ariaLabel: 'Metronome', pressed: true }))
        expect(on).toContain('aria-pressed="true"')
        expect(on).toContain('bg-primary-container')
        // Hover never swaps the on-state fill for grey, so the on state stays visible under the pointer.
        expect(on).not.toContain('hover:bg-surface-container-high')
        expect(html(createElement(TransportBtn, { size: 36, ariaLabel: 'Metronome', pressed: false }))).toContain(
            'hover:bg-surface-container-high',
        )
        expect(html(createElement(TransportBtn, { size: 36, ariaLabel: 'Stop' }))).not.toContain('aria-pressed')
    })

    it('the record tone draws a dot at rest and crossfades to a stop square while live', () => {
        const glyphs = (active: boolean) => {
            const markup = html(createElement(TransportBtn, { size: 48, ariaLabel: 'Record', tone: 'record', active }))
            const box = document.createElement('div')
            box.innerHTML = markup
            const [dot, square] = Array.from(box.querySelectorAll('button > span'))
            return { dot: dot.className, square: square.className, squareMarked: square.hasAttribute('data-stop-glyph') }
        }
        const rest = glyphs(false)
        expect(rest.dot).toContain('opacity-100')
        expect(rest.square).toContain('opacity-0')
        expect(rest.squareMarked).toBe(true)
        const live = glyphs(true)
        expect(live.dot).toContain('opacity-0')
        expect(live.square).toContain('opacity-100')
        // The swap is a crossfade, and instant under reduced motion.
        expect(live.square).toContain('motion-reduce:transition-none')
    })

    it('grows on hover only when motion is welcome', () => {
        const play = html(createElement(TransportBtn, { size: 40, ariaLabel: 'Play', tone: 'play' }))
        expect(play).toContain('motion-safe:hover:scale-105')
        expect(play).not.toMatch(/ hover:scale-105/)
    })
})
