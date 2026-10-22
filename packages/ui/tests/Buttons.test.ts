import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { CloseButton, IconButton, PrimaryButton, SecondaryButton, TertiaryButton } from '../src/Buttons'

const html = (el: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(el)

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

    it('keeps the disabled-hover freeze on pop buttons only', () => {
        const freeze = 'disabled:hover:shadow-(--shadow-offset-3)'
        expect(html(createElement(PrimaryButton, { children: 'Go', emphasis: 'pop' }))).toContain(freeze)
        expect(html(createElement(PrimaryButton, { children: 'Go' }))).not.toContain(freeze)
        expect(html(createElement(PrimaryButton, { children: 'Delete', emphasis: 'pop', danger: true }))).not.toContain(freeze)
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

    it('maps each hover tone to its fill', () => {
        expect(html(createElement(IconButton, { icon: 'play' }))).toContain('hover:bg-primary-container')
        expect(html(createElement(IconButton, { icon: 'trash-2', hoverTone: 'magenta' }))).toContain('hover:bg-secondary-container')
        const neutral = html(createElement(IconButton, { icon: 'play', hoverTone: 'neutral' }))
        expect(neutral).toContain('hover:bg-surface-container-high')
        expect(neutral).not.toContain('hover:bg-primary-container')
    })
})
