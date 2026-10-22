import { TextField } from '@mushee/ui'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { isAcceptablePassword, NEW_PASSWORD_HINT, PasswordStrength, scorePassword, strengthLabel } from '@/components/ui/Password'
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

    it('never scores a password under the 8-character minimum above zero', () => {
        expect(scorePassword('Abc12!x')).toBe(0)
        expect(isAcceptablePassword('Abc12!x', 'Abc12!x')).toBe(false)
    })

    it('accepts an OK-or-better password whose confirmation matches', () => {
        expect(isAcceptablePassword('correct-horse-battery', 'correct-horse-battery')).toBe(true)
        expect(isAcceptablePassword('correct-horse-battery', 'correct-horse')).toBe(false)
        expect(isAcceptablePassword('eightchr', 'eightchr')).toBe(false)
        expect(isAcceptablePassword('', '')).toBe(false)
    })
})

describe('PasswordStrength', () => {
    it('stays hidden until the first keystroke', () => {
        expect(html(createElement(PasswordStrength, { password: '' }))).toBe('')
        expect(strengthLabel('')).toBeNull()
    })

    it('says "Keep going" under 8 characters, then Weak / OK / Strong, in plain sentence case', () => {
        expect(strengthLabel('a')).toBe('Keep going')
        expect(strengthLabel('Abc12!x')).toBe('Keep going')
        expect(strengthLabel('eightchr')).toBe('Weak')
        expect(strengthLabel('eightch1')).toBe('OK')
        expect(strengthLabel('Twelve-chars-1')).toBe('Strong')
        const markup = html(createElement(PasswordStrength, { password: 'abc' }))
        expect(markup).toContain('>Keep going</span>')
        expect(markup).toContain('text-[12px]')
        expect(markup).not.toContain('uppercase')
    })
})

describe('PasswordField', () => {
    it('is empty when empty: no mask-dot placeholder', () => {
        expect(html(createElement(PasswordField, { label: 'Password', value: '' }))).not.toContain('placeholder')
        expect(html(createElement(PasswordField, { label: 'Password', value: '', placeholder: 'Your password' }))).toContain(
            'placeholder="Your password"',
        )
    })

    it('gives the reveal button a 40px hit area', () => {
        const markup = html(createElement(PasswordField, { label: 'Password', value: '' }))
        expect(markup).toMatch(/<button[^>]*class="size-10 /)
    })

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

    it('renders one toggle for both fields, the rule as a hint, and the strength meter', () => {
        const markup = fields({})
        expect(markup.match(/aria-label="Show password"/g)).toHaveLength(1)
        expect(markup.match(/type="password"/g)).toHaveLength(2)
        expect(markup).toContain('Confirm password')
        expect(markup).toContain(NEW_PASSWORD_HINT)
        expect(markup).toContain('>Strong</span>')
    })

    it('shows no meter before anything is typed', () => {
        const markup = fields({ value: '' })
        expect(markup).toContain(NEW_PASSWORD_HINT)
        expect(markup).not.toContain('-mt-2')
    })

    it('hints at a mismatch only once the confirmation has been typed', () => {
        expect(fields({})).not.toContain('match yet')
        expect(fields({ confirm: 'correct-horse' })).not.toContain('match yet')
        expect(fields({ confirm: 'correct' })).toContain('Passwords don&#x27;t match yet.')
    })

    it('puts the form’s own confirmation error on its own line after the mismatch hint', () => {
        expect(fields({ confirm: 'correct', confirmError: 'Pick something different.' })).toContain(
            '<span class="block">Passwords don&#x27;t match yet.</span><span class="block">Pick something different.</span>',
        )
        expect(fields({ confirm: 'correct-horse', confirmError: 'Pick something different.' })).toContain('Pick something different.')
    })
})

describe('TextField error', () => {
    it('renders the inline error line under the input', () => {
        const markup = html(createElement(TextField, { label: 'Code', value: '', error: 'That code didn’t work.' }))
        expect(markup).toMatch(/<\/div><span [^>]*class="[^"]*text-error"[^>]*>That code didn’t work\.<\/span><\/div>$/)
        expect(html(createElement(TextField, { label: 'Code', value: '', error: null }))).not.toContain('text-error')
    })
})
