import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { TextField } from '@/components/ui/Inputs'
import { isAcceptablePassword, scorePassword } from '@/components/ui/Password'
import { NewPasswordFields, PasswordField } from '@/components/ui/PasswordField'

const html = (el: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(el)
const noop = () => {}

describe('password policy', () => {
    it('scores length, mixed case and digits/symbols', () => {
        expect(scorePassword('')).toBe(0)
        expect(scorePassword('short')).toBe(0)
        expect(scorePassword('eightchr')).toBe(1)
        expect(scorePassword('eightch1')).toBe(2)
        expect(scorePassword('Twelve-chars-1')).toBe(4)
    })

    it('accepts an OK-or-better password whose confirmation matches', () => {
        expect(isAcceptablePassword('correct-horse-battery', 'correct-horse-battery')).toBe(true)
        expect(isAcceptablePassword('correct-horse-battery', 'correct-horse')).toBe(false)
        expect(isAcceptablePassword('eightchr', 'eightchr')).toBe(false)
        expect(isAcceptablePassword('', '')).toBe(false)
    })
})

describe('PasswordField', () => {
    it('keeps its own reveal state behind one "Show password" toggle', () => {
        const markup = html(createElement(PasswordField, { label: 'Password', value: 'x' }))
        expect(markup).toContain('type="password"')
        expect(markup.match(/aria-label="Show password"/g)).toHaveLength(1)
        expect(markup).toContain('aria-pressed="false"')
        expect(markup).toContain('focus-ring')
    })

    it('follows a controlled state, without a button of its own when no toggle is passed', () => {
        const follower = html(createElement(PasswordField, { label: 'Current password', value: 'x', shown: true }))
        expect(follower).toContain('type="text"')
        expect(follower).not.toContain('<button')

        const driver = html(createElement(PasswordField, { label: 'New password', value: 'x', shown: true, onToggleShown: noop }))
        expect(driver).toContain('aria-pressed="true"')
    })
})

describe('NewPasswordFields', () => {
    const fields = (props: Partial<Parameters<typeof NewPasswordFields>[0]>) =>
        html(
            createElement(NewPasswordFields, {
                value: 'correct-horse',
                onChange: noop,
                confirm: '',
                onConfirmChange: noop,
                confirmLabel: 'Confirm password',
                ...props,
            }),
        )

    it('renders one toggle for both fields and the strength meter', () => {
        const markup = fields({})
        expect(markup.match(/aria-label="Show password"/g)).toHaveLength(1)
        expect(markup.match(/type="password"/g)).toHaveLength(2)
        expect(markup).toContain('Confirm password')
    })

    it('hints at a mismatch only once the confirmation has been typed', () => {
        expect(fields({})).not.toContain('match yet')
        expect(fields({ confirm: 'correct-horse' })).not.toContain('match yet')
        expect(fields({ confirm: 'correct' })).toContain('Passwords don&#x27;t match yet.')
    })

    it('appends the form’s own confirmation error after the mismatch hint', () => {
        expect(fields({ confirm: 'correct', confirmError: 'Pick something different.' })).toContain(
            'Passwords don&#x27;t match yet. Pick something different.',
        )
        expect(fields({ confirm: 'correct-horse', confirmError: 'Pick something different.' })).toContain('Pick something different.')
    })
})

describe('TextField error', () => {
    it('renders the inline error line under the input', () => {
        const markup = html(createElement(TextField, { label: 'Code', value: '', error: 'That code didn’t work.' }))
        expect(markup).toMatch(/<\/div><span class="[^"]*text-error">That code didn’t work\.<\/span><\/div>$/)
        expect(html(createElement(TextField, { label: 'Code', value: '', error: null }))).not.toContain('text-error')
    })
})
