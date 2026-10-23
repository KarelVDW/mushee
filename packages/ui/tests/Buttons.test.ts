import Link from 'next/link'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { CloseButton, IconButton, PrimaryButton, SecondaryButton, TertiaryButton, TEXT_LINK_CLASS, TextLink } from '../src/Buttons'

const html = (el: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(el)
const classesOf = (markup: string) => (/class="([^"]*)"/.exec(markup)?.[1] ?? '').split(' ')

describe('capsule buttons', () => {
    it('render a typed <button> without href', () => {
        const primary = html(createElement(PrimaryButton, { children: 'Save' }))
        expect(primary).toMatch(/^<button type="button"/)
        expect(html(createElement(PrimaryButton, { children: 'Go', type: 'submit' }))).toContain('type="submit"')
        expect(html(createElement(SecondaryButton, { children: 'Cancel', disabled: true }))).toMatch(/^<button type="button" disabled=""/)
        expect(html(createElement(TertiaryButton, { children: 'Keep' }))).toMatch(/^<button type="button"/)
    })

    it('render a link with the same classes when given href', () => {
        for (const Button of [PrimaryButton, SecondaryButton, TertiaryButton]) {
            const asButton = html(createElement(Button, { children: 'Library' }))
            const asLink = html(createElement(Button, { children: 'Library', href: '/scores' }))
            expect(asLink).toMatch(/^<a /)
            expect(asLink).toContain('href="/scores"')
            expect(asLink).not.toContain('type=')
            const classOf = (markup: string) => /class="([^"]*)"/.exec(markup)?.[1]
            expect(classOf(asLink)).toBe(classOf(asButton))
        }
    })

    it('deepens the neon on hover and press instead of inverting it to dark teal', () => {
        const classes = classesOf(html(createElement(PrimaryButton, { children: 'Save' })))
        expect(classes).toEqual(
            expect.arrayContaining([
                'bg-primary-container',
                'hover:bg-primary-container-hover',
                'hover:text-on-primary-soft',
                'active:bg-primary-container-pressed',
                'active:text-on-primary-soft',
            ]),
        )
        expect(classes).not.toContain('hover:bg-primary')
        const danger = classesOf(html(createElement(PrimaryButton, { children: 'Delete', danger: true })))
        expect(danger).toEqual(expect.arrayContaining(['bg-error-container', 'hover:bg-error', 'active:brightness-90']))
    })

    it('gives every capsule the same 0.97 press, never on a disabled one', () => {
        const press = 'motion-safe:not-disabled:not-aria-disabled:active:scale-[0.97]'
        expect(classesOf(html(createElement(PrimaryButton, { children: 'Save' })))).toContain(press)
        expect(classesOf(html(createElement(SecondaryButton, { children: 'Cancel' })))).toContain(press)
        expect(classesOf(html(createElement(IconButton, { icon: 'play' })))).toContain(press)
        expect(classesOf(html(createElement(PrimaryButton, { children: 'Save' })))).toContain('duration-(--t-press)')
    })

    it('lifts a pop button on hover and sinks it onto its plate on press', () => {
        const pop = classesOf(html(createElement(PrimaryButton, { children: 'Go', emphasis: 'pop' })))
        expect(pop).toEqual(
            expect.arrayContaining([
                'shadow-(--shadow-offset-3)',
                'hover:shadow-(--shadow-offset-5)',
                'hover:-translate-y-[2px]',
                'active:translate-x-[3px]',
                'active:translate-y-[3px]',
                'active:shadow-none',
            ]),
        )
        expect(classesOf(html(createElement(PrimaryButton, { children: 'Go' })))).not.toContain('shadow-(--shadow-offset-3)')
        expect(classesOf(html(createElement(PrimaryButton, { children: 'Delete', emphasis: 'pop', danger: true })))).not.toContain(
            'shadow-(--shadow-offset-3)',
        )
    })

    it('disables every primary as a still, neutral capsule: no fade, no magenta ghost', () => {
        for (const props of [{}, { emphasis: 'pop' as const }, { danger: true }]) {
            const classes = classesOf(html(createElement(PrimaryButton, { children: 'Go', disabled: true, ...props })))
            for (const variant of ['disabled', 'aria-disabled']) {
                expect(classes).toEqual(
                    expect.arrayContaining([
                        `${variant}:bg-surface-container`,
                        `${variant}:text-on-surface-variant`,
                        `${variant}:opacity-100`,
                        `${variant}:shadow-none`,
                        `${variant}:translate-y-0`,
                    ]),
                )
            }
            expect(classes).not.toContain('disabled:opacity-40')
            expect(classes.some((c) => c.startsWith('disabled:hover:'))).toBe(false)
        }
    })
})

describe('capsule heights', () => {
    it('come from the control tokens, never padding, so an icon never changes them', () => {
        expect(classesOf(html(createElement(PrimaryButton, { children: 'Save' })))).toEqual(
            expect.arrayContaining(['h-(--control-md)', 'px-5', 'text-[13px]']),
        )
        expect(classesOf(html(createElement(PrimaryButton, { children: 'Save', icon: 'plus' })))).toContain('h-(--control-md)')
        expect(classesOf(html(createElement(PrimaryButton, { children: 'Start free', size: 'lg' })))).toEqual(
            expect.arrayContaining(['h-(--control-lg)', 'px-6.5', 'text-[14px]']),
        )
        for (const markup of [
            html(createElement(PrimaryButton, { children: 'Save' })),
            html(createElement(SecondaryButton, { children: 'Cancel' })),
        ]) {
            expect(classesOf(markup).some((c) => /(^|:)py-/.test(c))).toBe(false)
        }
    })

    it('render an icon-only primary as a true circle', () => {
        const classes = classesOf(html(createElement(PrimaryButton, { icon: 'plus', ariaLabel: 'New score', emphasis: 'pop' })))
        expect(classes).toEqual(expect.arrayContaining(['px-0', 'aspect-square', 'size-(--control-md)', 'shadow-(--shadow-offset-3)']))
        expect(classesOf(html(createElement(PrimaryButton, { children: 'New score', icon: 'plus' })))).not.toContain('aspect-square')
    })
})

describe('SecondaryButton', () => {
    it('defaults to md on the tonal control fill', () => {
        const classes = classesOf(html(createElement(SecondaryButton, { children: 'Import file' })))
        expect(classes).toEqual(
            expect.arrayContaining([
                'h-(--control-md)',
                'text-[13px]',
                'bg-(--control-fill)',
                'hover:bg-(--control-fill-hover)',
                'active:bg-(--control-fill-press)',
            ]),
        )
    })

    it('takes the lg height and the raised white tone', () => {
        const classes = classesOf(html(createElement(SecondaryButton, { children: 'Choose Studio', size: 'lg', tone: 'raised' })))
        expect(classes).toEqual(
            expect.arrayContaining([
                'h-(--control-lg)',
                'text-[14px]',
                'bg-surface-container-lowest',
                'tonal-layer-glow',
                'hover:bg-surface-container-low',
            ]),
        )
        expect(classes).not.toContain('bg-(--control-fill)')
    })

    it('keeps its own fill when disabled and mutes the label instead of fading', () => {
        const classes = classesOf(html(createElement(SecondaryButton, { children: 'Cancel', disabled: true })))
        expect(classes).toEqual(
            expect.arrayContaining([
                'disabled:bg-(--control-fill)',
                'disabled:opacity-100',
                'disabled:text-on-surface-variant',
                'aria-disabled:opacity-100',
            ]),
        )
        expect(classes).not.toContain('disabled:opacity-40')
    })
})

describe('TertiaryButton', () => {
    it('speaks in the label face, on_surface, at least --control-sm tall', () => {
        const classes = classesOf(html(createElement(TertiaryButton, { children: 'Forgot password?' })))
        expect(classes).toEqual(
            expect.arrayContaining([
                'font-label',
                'font-semibold',
                'text-[13px]',
                'text-on-surface',
                'hover:text-primary',
                'min-h-(--control-sm)',
            ]),
        )
        expect(classes).not.toContain('text-on-surface-variant')
        expect(classesOf(html(createElement(TertiaryButton, { children: 'Delete', danger: true })))).toContain('text-secondary')
    })
})

describe('TextLink', () => {
    it('renders an anchor with the shared link class, adding the caller class', () => {
        const markup = html(createElement(TextLink, { href: 'mailto:support@solkey.io', children: 'support@solkey.io' }))
        expect(markup).toBe(`<a href="mailto:support@solkey.io" class="${TEXT_LINK_CLASS}">support@solkey.io</a>`)
        expect(html(createElement(TextLink, { href: '/privacy', className: 'whitespace-nowrap', children: 'privacy policy' }))).toContain(
            `class="${TEXT_LINK_CLASS} whitespace-nowrap"`,
        )
    })

    it('renders next/link for in-app routes', () => {
        const markup = html(createElement(TextLink, { as: Link, href: '/pricing', children: 'See plans' }))
        expect(markup).toMatch(/^<a /)
        expect(markup).toContain('href="/pricing"')
        expect(markup).toContain(TEXT_LINK_CLASS)
    })

    it('inherits the font size and keeps the quiet underline that firms up on hover', () => {
        const classes = TEXT_LINK_CLASS.split(' ')
        expect(classes).toEqual(
            expect.arrayContaining([
                'text-primary',
                'underline',
                'decoration-primary/35',
                'underline-offset-[3px]',
                'hover:decoration-primary',
                'focus-ring',
            ]),
        )
        expect(classes.some((c) => c.startsWith('text-['))).toBe(false)
    })
})

describe('TertiaryButton disabled', () => {
    it('sets the native attribute, dims like the capsules and freezes the hover colour', () => {
        const markup = html(createElement(TertiaryButton, { children: 'Check my status', disabled: true }))
        expect(markup).toMatch(/^<button type="button" disabled=""/)
        expect(markup).toContain('disabled:opacity-40 disabled:cursor-not-allowed')
        expect(markup).toContain('hover:text-primary disabled:hover:text-on-surface')
        const danger = html(createElement(TertiaryButton, { children: 'Delete', danger: true, disabled: true }))
        expect(danger).toContain('hover:text-secondary-container disabled:hover:text-secondary')
    })

    it('stays enabled by default', () => {
        expect(html(createElement(TertiaryButton, { children: 'Keep' }))).not.toContain('disabled=""')
    })
})

describe('CloseButton', () => {
    it('is a labelled, non-submitting × with the shared focus ring', () => {
        const markup = html(createElement(CloseButton, { onClick: () => {} }))
        expect(markup).toMatch(/^<button type="button" aria-label="Close"/)
        expect(markup).toContain('focus-ring')
        expect(markup).toContain('width="14"')
    })

    it('takes a custom label and a dialog-header size', () => {
        const markup = html(createElement(CloseButton, { onClick: () => {}, ariaLabel: 'Dismiss', size: 'md' }))
        expect(markup).toContain('aria-label="Dismiss"')
        expect(markup).toContain('width="20"')
    })
})

describe('IconButton', () => {
    it('passes disabled and title through to the button', () => {
        const markup = html(createElement(IconButton, { icon: 'play', ariaLabel: 'Play take', disabled: true, title: 'No audio' }))
        expect(markup).toContain('disabled=""')
        expect(markup).toContain('title="No audio"')
        expect(markup).toContain('aria-label="Play take"')
    })

    it('rests on the control fill and maps each hover tone to its fill and press step', () => {
        const cyan = classesOf(html(createElement(IconButton, { icon: 'play' })))
        expect(cyan).toEqual(
            expect.arrayContaining(['bg-(--control-fill)', 'hover:bg-primary-container', 'active:bg-primary-container-pressed']),
        )
        expect(classesOf(html(createElement(IconButton, { icon: 'trash-2', hoverTone: 'magenta' })))).toEqual(
            expect.arrayContaining(['hover:bg-secondary-container', 'active:bg-secondary']),
        )
        const neutral = classesOf(html(createElement(IconButton, { icon: 'play', hoverTone: 'neutral' })))
        expect(neutral).toEqual(expect.arrayContaining(['hover:bg-(--control-fill-hover)', 'active:bg-(--control-fill-press)']))
        expect(neutral).not.toContain('hover:bg-primary-container')
        expect(classesOf(html(createElement(IconButton, { icon: 'play', idleClassName: 'bg-transparent' })))).not.toContain(
            'bg-(--control-fill)',
        )
    })

    it('defaults to the --control-sm circle and keeps an explicit pixel size inline', () => {
        const unsized = html(createElement(IconButton, { icon: 'play', ariaLabel: 'Play' }))
        expect(classesOf(unsized)).toContain('size-(--control-sm)')
        expect(/^<button[^>]*>/.exec(unsized)?.[0]).not.toContain('style=')
        expect(unsized).toContain('width="16"')
        const small = html(createElement(IconButton, { icon: 'play', ariaLabel: 'Play', size: 24 }))
        expect(small).toContain('width:24px;height:24px')
        expect(classesOf(small)).not.toContain('size-(--control-sm)')
        expect(small).toContain('width="14"')
    })
})

describe('coarse-pointer tap floors', () => {
    const FLOOR = 'pointer-coarse:min-h-10 pointer-coarse:min-w-10'

    it('give icon and close buttons a 40px floor without changing fine-pointer sizes', () => {
        const icon = html(createElement(IconButton, { icon: 'more-horizontal', ariaLabel: 'More actions', size: 32 }))
        expect(icon).toContain(FLOOR)
        expect(icon).toContain('width:32px;height:32px')
        expect(icon).not.toContain('after:-inset')
        expect(html(createElement(IconButton, { icon: 'more-horizontal', ariaLabel: 'More actions', size: 40 }))).toContain(
            'width:40px;height:40px',
        )
        expect(html(createElement(CloseButton, { onClick: () => {} }))).toContain(FLOOR)
    })

    it('give tertiary buttons the --control-sm floor (40px on coarse pointers) and a 40px width floor', () => {
        const tertiary = html(createElement(TertiaryButton, { children: 'Forgot password?' }))
        expect(tertiary).toContain('min-h-(--control-sm) pointer-coarse:min-w-10')
        expect(tertiary).toContain('inline-flex items-center justify-center')
        expect(tertiary).toContain(' py-2 ')
    })
})
