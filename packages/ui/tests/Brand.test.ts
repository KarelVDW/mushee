import { readFileSync } from 'node:fs'

import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { ModalTitle, PageTitle, PriceTag, SubHeadline } from '../src/Brand'

const html = (el: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(el)

describe('titles', () => {
    it('set the page title in the page role', () => {
        expect(html(createElement(PageTitle, { children: 'Your scores' }))).toBe(
            '<h1 class="type-page text-on-surface m-0">Your scores</h1>',
        )
    })

    it('set a dialog title in the title role, as an h2 by default', () => {
        expect(html(createElement(ModalTitle, { children: 'New score' }))).toBe(
            '<h2 class="type-title text-on-surface m-0 outline-none">New score</h2>',
        )
    })

    it('let a dialog title be the page’s h1, or the compact lead size', () => {
        expect(html(createElement(ModalTitle, { as: 'h1', children: 'Welcome back' }))).toMatch(/^<h1 class="type-title /)
        expect(html(createElement(ModalTitle, { size: 'lead', id: 't', children: 'Delete this score?' }))).toBe(
            '<h2 id="t" class="font-display font-semibold text-[22px] leading-tight tracking-[-0.02em] text-on-surface m-0 outline-none">Delete this score?</h2>',
        )
    })

    it('wrap a sub-headline pretty', () => {
        expect(html(createElement(SubHeadline, { children: 'Pick up where you left off.' }))).toContain('text-pretty')
    })
})

describe('PriceTag', () => {
    it('sets the amount in bold display figures beside a quiet cadence', () => {
        expect(html(createElement(PriceTag, { amount: '$9', cadence: '/ month' }))).toBe(
            '<span class="inline-flex flex-col gap-1 "><span class="inline-flex items-baseline gap-1.5">' +
                '<span class="font-display font-bold tabular-nums tracking-[-0.03em] leading-none text-[28px]">$9</span>' +
                '<span class="font-body font-normal text-[14px] leading-none text-on-surface-variant">/ month</span></span></span>',
        )
    })

    it('scales the amount to 32px and 44px, and never sets a price in mono', () => {
        expect(html(createElement(PriceTag, { amount: '$19', size: 'lg' }))).toContain('leading-none text-[32px]">$19<')
        const free = html(createElement(PriceTag, { amount: 'Free', size: 'xl' }))
        expect(free).toContain('leading-none text-[44px]">Free<')
        expect(free).not.toContain('font-mono')
    })

    it('shows a note line, or holds its height invisibly with note={null}', () => {
        expect(html(createElement(PriceTag, { amount: '$9', note: 'billed yearly' }))).toContain(
            '<span class="font-body font-normal text-[13px] leading-[1.4] text-on-surface-variant ">billed yearly</span>',
        )
        expect(html(createElement(PriceTag, { amount: 'Free', note: null }))).toContain(
            '<span aria-hidden="true" class="font-body font-normal text-[13px] leading-[1.4] text-on-surface-variant invisible"> </span>',
        )
        expect(html(createElement(PriceTag, { amount: 'Free' }))).not.toContain('text-[13px]')
    })
})

describe('type roles', () => {
    const theme = readFileSync(new URL('../src/theme.css', import.meta.url), 'utf8')
    const role = (name: string) => new RegExp(`@utility ${name} \\{([\\s\\S]*?)\\n\\}`).exec(theme)?.[1] ?? ''

    it('defines every role, the display ones stepping up at sm (and lg for the hero)', () => {
        const roles = [
            'hero',
            'page',
            'title',
            'heading',
            'subheading',
            'label',
            'lede',
            'body',
            'body-lg',
            'hint',
            'caption',
            'eyebrow',
            'button',
            'button-lg',
            'numeral',
        ]
        for (const name of roles) expect(role(`type-${name}`), name).not.toBe('')
        expect(role('type-hero')).toMatch(
            /font-size: 40px;[\s\S]*@variant sm \{\s*font-size: 56px;[\s\S]*@variant lg \{\s*font-size: 72px;/,
        )
        expect(role('type-page')).toMatch(/font-size: 34px;[\s\S]*@variant sm \{\s*font-size: 48px;/)
        expect(role('type-title')).toMatch(/font-size: 26px;[\s\S]*@variant sm \{\s*font-size: 32px;/)
        expect(role('type-numeral')).toContain('font-variant-numeric: tabular-nums;')
    })
})
