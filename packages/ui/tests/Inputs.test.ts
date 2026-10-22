import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { Chip, TextArea, TextField } from '../src/Inputs'

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

    it('renders 16px text on coarse pointers, a visible placeholder and a primary focus stroke', () => {
        const markup = html(createElement(TextField, { value: '' }))
        expect(inputTag(markup)).toContain('pointer-coarse:text-[16px]')
        expect(inputTag(markup)).toContain('pointer-coarse:py-3.5')
        expect(inputTag(markup)).toContain('placeholder:text-on-surface-variant')
        expect(markup).toContain('h-0.5 bg-primary transition-[left,right]')
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

describe('Chip', () => {
    it('grows to the 40px floor on coarse pointers', () => {
        const markup = html(createElement(Chip, { onClick: () => {}, children: 'Piano' }))
        expect(markup).toContain('pointer-coarse:min-h-10')
        expect(markup).toContain('pointer-coarse:px-4')
    })
})
