import { readFileSync } from 'node:fs'

import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { Chip, FieldFrame, SelectedMark, TextArea, TextField } from '../src/Inputs'

const html = (el: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(el)
const inputTag = (markup: string) => /<input[^>]*>/.exec(markup)?.[0] ?? ''
const attr = (tag: string, name: string) => new RegExp(`${name}="([^"]*)"`).exec(tag)?.[1]

describe('TextField', () => {
    it('passes the autofill and keyboard attributes through to the input', () => {
        const input = inputTag(
            html(
                createElement(TextField, {
                    label: '6-digit code',
                    value: '',
                    autoComplete: 'one-time-code',
                    inputMode: 'numeric',
                    enterKeyHint: 'done',
                    autoCapitalize: 'none',
                    name: 'code',
                    required: true,
                }),
            ),
        )
        expect(attr(input, 'autoComplete')).toBe('one-time-code')
        expect(attr(input, 'inputMode')).toBe('numeric')
        expect(attr(input, 'enterKeyHint')).toBe('done')
        expect(attr(input, 'autoCapitalize')).toBe('none')
        expect(attr(input, 'name')).toBe('code')
        expect(input).toContain('required=""')
    })

    it('links the hint and the error to the input and marks it invalid', () => {
        const markup = html(
            createElement(TextField, { label: 'Password', value: '', hint: 'At least 8 characters.', error: 'Use at least 8 characters.' }),
        )
        const input = inputTag(markup)
        expect(attr(input, 'aria-invalid')).toBe('true')
        const ids = attr(input, 'aria-describedby')?.split(' ') ?? []
        expect(ids).toHaveLength(2)
        expect(markup).toContain(`<span id="${ids[0]}" class="font-body font-normal text-[12px]`)
        expect(markup).toContain(`<span id="${ids[1]}" class="font-body font-medium text-[12px]`)
    })

    it('leaves aria-invalid and aria-describedby off a clean field', () => {
        const input = inputTag(html(createElement(TextField, { label: 'Email', value: '' })))
        expect(input).not.toContain('aria-invalid')
        expect(input).not.toContain('aria-describedby')
    })

    it('takes an accessible name for label-less search fields', () => {
        const input = inputTag(html(createElement(TextField, { value: '', placeholder: 'Find a score…', ariaLabel: 'Search your scores' })))
        expect(attr(input, 'aria-label')).toBe('Search your scores')
    })

    it('renders 16px text on coarse pointers and a primary focus stroke that grows from the centre', () => {
        const markup = html(createElement(TextField, { value: '' }))
        expect(inputTag(markup)).toContain('pointer-coarse:text-[16px]')
        expect(inputTag(markup)).toContain('pointer-coarse:py-3.5')
        // Lit by the input's own focus, so a focused clear × or password toggle in the frame doesn't sweep it.
        expect(markup).toContain('h-0.5 bg-primary origin-center scale-x-0 group-has-[:is(input,textarea,select):focus]/field:scale-x-100')
        expect(markup).not.toContain('focus-within')
        expect(markup).toContain('duration-(--t-flow)')
    })

    it('rests with no stroke while clean, and a full-width error stroke under the focus stroke while invalid', () => {
        const clean = html(createElement(TextField, { label: 'Email', value: '' }))
        expect(clean).not.toContain('bg-error')
        const invalid = html(createElement(TextField, { label: 'Email', value: 'x', error: 'Enter a valid email.' }))
        const errorStroke = invalid.indexOf('<span aria-hidden="true" class="absolute inset-x-0 bottom-0 h-0.5 bg-error">')
        const focusStroke = invalid.indexOf('z-1 h-0.5 bg-primary')
        expect(errorStroke).toBeGreaterThan(-1)
        // Later in the DOM and on z-1: focusing still sweeps primary over the red.
        expect(focusStroke).toBeGreaterThan(errorStroke)
        expect(attr(inputTag(invalid), 'aria-invalid')).toBe('true')
    })

    it('takes a compact 40px input row on fine pointers only', () => {
        const compact = html(createElement(TextField, { value: '', ariaLabel: 'Search your scores', size: 'compact' }))
        expect(compact).toContain('pointer-fine:h-10')
        expect(inputTag(compact)).toContain('pointer-fine:py-2.5')
        expect(inputTag(compact)).toContain('pointer-coarse:py-3.5')
        expect(html(createElement(TextField, { value: '' }))).not.toContain('pointer-fine:h-10')
    })

    it('keeps the label wired to the input and wraps the hint pretty', () => {
        const markup = html(createElement(TextField, { label: 'Your name', value: '', hint: 'Shown on your scores.' }))
        const id = attr(inputTag(markup), 'id')
        expect(markup).toContain(`<label for="${id}"`)
        expect(markup).toMatch(/<span id="[^"]*-hint" class="[^"]*text-pretty/)
    })

    it('shows the clear button only while the field has text', () => {
        expect(html(createElement(TextField, { value: '', clearLabel: 'Clear search' }))).not.toContain('Clear search')
        const markup = html(createElement(TextField, { value: 'scale', clearLabel: 'Clear search' }))
        expect(markup).toMatch(/<button type="button" aria-label="Clear search" title="Clear search" class="[^"]*w-10 h-10/)
    })
})

describe('TextArea', () => {
    it('shares the coarse-pointer type size and takes an accessible name', () => {
        const markup = html(createElement(TextArea, { value: '', ariaLabel: 'Notes', name: 'notes' }))
        expect(markup).toContain('pointer-coarse:text-[16px]')
        expect(markup).toContain('aria-label="Notes"')
        expect(markup).toContain('name="notes"')
    })
})

describe('the input fill', () => {
    const theme = readFileSync(new URL('../src/theme.css', import.meta.url), 'utf8')
    /** The declarations of every top-level rule for one selector in theme.css. */
    const rule = (selector: string) =>
        [...theme.matchAll(new RegExp(`^${selector.replace('.', '\\.')} \\{([^}]*)\\}`, 'gm'))].map((match) => match[1]).join('\n')

    it('comes from the container: TextField and TextArea read --field-fill, never a fixed tone', () => {
        for (const markup of [html(createElement(TextField, { value: '' })), html(createElement(TextArea, { value: '' }))]) {
            expect(markup).toContain('bg-(--field-fill) rounded-sm')
            expect(markup).not.toContain('bg-surface-container-low')
        }
    })

    it('is surface_container_low on the page and on the opaque dialogs alike — no glass panel overrides it', () => {
        expect(rule(':root')).toContain('--field-fill: var(--color-surface-container-low);')
        expect(rule('.glass-panel')).toBe('')
    })
})

describe('FieldFrame', () => {
    it('is the filled, at-least-md box with only the focus stroke at rest', () => {
        const markup = html(createElement(FieldFrame, { className: 'px-3', children: createElement('input', { 'aria-label': 'Link' }) }))
        expect(markup).toMatch(/^<div class="relative group\/field bg-\(--field-fill\) rounded-sm min-h-\(--control-md\) px-3">/)
        expect(markup).toContain('<input aria-label="Link"/>')
        expect(markup).not.toContain('bg-error')
        expect(markup.match(/aria-hidden="true"/g)).toHaveLength(1)
        expect(html(createElement(FieldFrame, { invalid: true, children: null }))).toContain('bg-error')
    })
})

describe('Chip', () => {
    it('grows to the 40px floor on coarse pointers', () => {
        const markup = html(createElement(Chip, { onClick: () => {}, children: 'Piano' }))
        expect(markup).toContain('pointer-coarse:min-h-10')
        expect(markup).toContain('pointer-coarse:px-4')
    })

    it('rests on the control fill and, picked, takes the selected fill and a leading check', () => {
        const rest = html(createElement(Chip, { onClick: () => {}, children: 'Cello' }))
        expect(rest).toContain('bg-(--control-fill) text-on-surface hover:bg-(--control-fill-hover)')
        expect(rest).not.toContain('<svg')
        const picked = html(createElement(Chip, { onClick: () => {}, active: true, children: 'Cello' }))
        expect(picked).toContain('bg-(--color-selected) text-(--color-on-selected)')
        expect(picked).not.toContain('secondary-soft')
        expect(picked).toContain('aria-pressed="true"')
        expect(picked).toContain(' pl-3 ')
        // The check comes first, hidden from assistive tech, and scales in (at once under reduced motion).
        expect(picked).toMatch(
            /aria-pressed="true"[^>]*><span aria-hidden="true" class="inline-flex shrink-0 motion-safe:animate-\[pick-in_150ms_var\(--ease-solkey\)\]"><span[^>]*><svg[^>]*width="12"/,
        )
        expect(picked).toMatch(/<\/span>Cello<\/button>$/)
    })

    it('renders display-only without a hover when it has no onClick', () => {
        const markup = html(createElement(Chip, { children: 'Voice' }))
        expect(markup).toContain('disabled=""')
        expect(markup).not.toContain('hover:')
    })
})

describe('SelectedMark', () => {
    it('is an aria-hidden 18px primary_container disc holding a 12px check, placed by the caller', () => {
        const markup = html(createElement(SelectedMark, { className: 'absolute top-2 right-2' }))
        expect(markup).toMatch(
            /^<span aria-hidden="true" class="[^"]*rounded-full bg-primary-container text-on-primary-container size-4\.5 [^"]*absolute top-2 right-2"/,
        )
        expect(markup).toContain('width="12"')
        expect(markup).toContain('motion-safe:animate-[pick-in_150ms_var(--ease-solkey)]')
    })

    it('has a 14px size for compact grid cells', () => {
        const markup = html(createElement(SelectedMark, { size: 'sm' }))
        expect(markup).toContain('size-3.5')
        expect(markup).toContain('width="10"')
    })
})
