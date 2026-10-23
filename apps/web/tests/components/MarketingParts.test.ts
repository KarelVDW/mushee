import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { Haze } from '@/components/marketing/Haze'
import { SectionHeading } from '@/components/marketing/SectionHeading'
import { StepVignette, type StepVignetteKind } from '@/components/marketing/StepVignettes'

function mount(markup: string) {
    const host = document.createElement('div')
    host.innerHTML = markup
    return host
}

describe('SectionHeading', () => {
    it('is an optional primary eyebrow over the h2, with its id, and the sub under it', () => {
        const host = mount(
            renderToStaticMarkup(
                createElement(SectionHeading, { eyebrow: 'How it works', title: 'Three steps', sub: 'No setup.', id: 'how-title' }),
            ),
        )
        const eyebrow = host.firstElementChild?.firstElementChild
        expect(eyebrow?.textContent).toBe('How it works')
        expect(eyebrow?.className).toContain('text-primary')
        const h2 = host.querySelector('h2#how-title')
        expect(h2?.textContent).toBe('Three steps')
        expect(h2?.className).toContain('type-page')
        expect(h2?.className).toContain('mt-3')
        expect(host.querySelector('p:last-child')?.textContent).toBe('No setup.')
    })

    it('goes without an eyebrow or sub, centred, and takes a caller’s spacing in place of the default', () => {
        const host = mount(renderToStaticMarkup(createElement(SectionHeading, { title: 'Start free', align: 'center', className: 'mb-6' })))
        const root = host.firstElementChild
        expect(root?.className).toContain('text-center')
        expect(root?.className).toContain('mb-6')
        expect(root?.className).not.toContain('mb-12')
        expect(root?.children).toHaveLength(1)
        expect(host.querySelector('h2')?.className).toContain('mt-0')
    })

    it('starts at the left with the default space under it', () => {
        const root = mount(renderToStaticMarkup(createElement(SectionHeading, { title: 'Features' }))).firstElementChild
        expect(root?.className).toContain('mb-12 sm:mb-14')
        expect(root?.className).not.toContain('text-center')
    })
})

describe('StepVignette', () => {
    it.each<StepVignetteKind>(['record', 'sing', 'fix'])(
        'the %s tile is decorative: hidden from assistive technology, with no controls',
        (kind) => {
            const host = mount(renderToStaticMarkup(createElement(StepVignette, { kind })))
            const tile = host.firstElementChild
            expect(tile?.getAttribute('aria-hidden')).toBe('true')
            expect(host.querySelectorAll('button, a, input, [role="button"], [tabindex]')).toHaveLength(0)
        },
    )
})

describe('Haze', () => {
    it('is a decorative, unclickable glow read from the primary-container token', () => {
        const haze = mount(renderToStaticMarkup(createElement(Haze, { placement: 'top-right' }))).firstElementChild
        expect(haze?.getAttribute('aria-hidden')).toBe('true')
        expect(haze?.className).toContain('pointer-events-none')
        expect(haze?.className).toContain('var(--color-primary-container)')
        expect(haze?.className).not.toContain('blur')
    })

    it('fills its section’s height on the right edge', () => {
        const haze = mount(renderToStaticMarkup(createElement(Haze, { placement: 'right-edge' }))).firstElementChild
        expect(haze?.className).toContain('h-full')
    })

    it('keeps the corner glow inside its section, so its fade completes at the top and bottom edges', () => {
        const haze = mount(renderToStaticMarkup(createElement(Haze, { placement: 'top-right' }))).firstElementChild
        expect(haze?.className).not.toContain('-translate-y')
        expect(haze?.className).toContain('max-h-full')
    })
})
