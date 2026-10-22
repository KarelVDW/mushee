import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { AuthCard, AuthPrefill } from '@/components/ui/AuthCard'
import { AuthErrorCopy, type AuthErrorMessage } from '@/lib/AuthErrorCopy'

// React's act() refuses to run outside a test-aware environment.
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let unmount: (() => void) | undefined

afterEach(() => {
    unmount?.()
    unmount = undefined
    AuthPrefill.clear()
})

type CardProps = Parameters<typeof AuthCard>[0]

function render(props: Partial<CardProps> & Pick<CardProps, 'mode'>): HTMLElement {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const root = createRoot(host)
    act(() => root.render(createElement(AuthCard, { onSubmit: () => {}, ...props })))
    unmount = () => {
        act(() => root.unmount())
        host.remove()
    }
    return host
}

/** The input a visible label names. */
function field(host: HTMLElement, label: string): HTMLInputElement {
    const labelEl = [...host.querySelectorAll('label')].find((l) => l.textContent === label)
    const input = labelEl && host.querySelector<HTMLInputElement>(`#${CSS.escape(labelEl.htmlFor)}`)
    if (!input) throw new Error(`no field labelled ${label}`)
    return input
}

/** The text an input's aria-describedby points at. */
function description(host: HTMLElement, input: HTMLInputElement): string {
    return (input.getAttribute('aria-describedby') ?? '')
        .split(' ')
        .filter(Boolean)
        .map((id) => host.querySelector(`#${CSS.escape(id)}`)?.textContent ?? '')
        .join(' ')
}

const link = (host: HTMLElement, text: string) => [...host.querySelectorAll('a')].find((a) => a.textContent === text)
const error = (code: string): AuthErrorMessage => AuthErrorCopy.for({ code, message: 'Library English' })

describe('AuthCard', () => {
    it('gives password managers and phone keyboards what they need', () => {
        const signup = render({ mode: 'signup' })
        expect(field(signup, 'Your name').autocomplete).toBe('name')
        expect(field(signup, 'Email').type).toBe('email')
        expect(field(signup, 'Email').getAttribute('autocapitalize')).toBe('none')
        expect(field(signup, 'Password').autocomplete).toBe('new-password')
        expect(field(signup, 'Your name').required).toBe(true)
        unmount?.()

        const signin = render({ mode: 'signin' })
        expect(field(signin, 'Password').autocomplete).toBe('current-password')
        expect(field(signin, 'Password').placeholder).toBe('')
    })

    it('states the signup password rule up front, and what signing up costs', () => {
        const host = render({ mode: 'signup' })
        expect(description(host, field(host, 'Password'))).toBe('At least 8 characters.')
        expect(host.textContent).toContain('Free to start — no card needed.')
        expect(link(host, 'Terms')?.getAttribute('href')).toBe('/terms')
        expect(link(host, 'Privacy policy')?.getAttribute('href')).toBe('/privacy')
    })

    it('leads home from the wordmark', () => {
        const host = render({ mode: 'signin' })
        expect(host.querySelector('a[aria-label="Solkey home"]')?.getAttribute('href')).toBe('/')
    })

    it('puts a field problem under its field, linked and flagged, with no alert', () => {
        const host = render({ mode: 'signup', error: error('PASSWORD_TOO_SHORT') })
        const password = field(host, 'Password')
        expect(password.getAttribute('aria-invalid')).toBe('true')
        expect(description(host, password)).toContain('Use at least 8 characters.')
        expect(host.querySelector('[role="alert"]')).toBeNull()
    })

    it("links an error's next step in place, keeping ?next=, and never shows the library's words", () => {
        const host = render({ mode: 'signup', error: error('USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL'), next: '/s/token' })
        const alert = host.querySelector('[role="alert"]')
        expect(alert?.textContent).toBe("There's already an account with this email. Sign in instead?")
        expect(link(host, 'Sign in instead')?.getAttribute('href')).toBe('/login?next=%2Fs%2Ftoken')
        expect(host.textContent).not.toContain('Library English')
    })

    it('links the reset from a wrong password, and hands the typed email to the next form', () => {
        const host = render({ mode: 'signin', error: error('INVALID_EMAIL_OR_PASSWORD') })
        const email = field(host, 'Email')
        act(() => {
            Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(email, 'me@example.com')
            email.dispatchEvent(new Event('input', { bubbles: true }))
        })
        const reset = link(host, 'reset your password')
        expect(reset?.getAttribute('href')).toBe('/reset-password')
        act(() => {
            reset?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
        })
        expect(AuthPrefill.read()).toEqual({ email: 'me@example.com' })
    })

    it('fills in what the previous form handed over, and forgets it once submitted', () => {
        AuthPrefill.offer({ email: 'me@example.com', name: 'Robin Vale' })
        const onSubmit = vi.fn()
        const host = render({ mode: 'signup', onSubmit })
        expect(field(host, 'Email').value).toBe('me@example.com')
        expect(field(host, 'Your name').value).toBe('Robin Vale')

        act(() => {
            host.querySelector('form')?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
        })
        expect(onSubmit).toHaveBeenCalledWith({ name: 'Robin Vale', email: 'me@example.com', password: '' })
        expect(AuthPrefill.read()).toEqual({})
    })

    it('announces a notice politely, in a region that is there before the notice is', () => {
        const host = render({ mode: 'signin' })
        expect(host.querySelector('[role="status"]')?.textContent).toBe('')
        unmount?.()
        const withNotice = render({ mode: 'signin', notice: 'Signed out.' })
        expect(withNotice.querySelector('[role="status"]')?.textContent).toBe('Signed out.')
    })
})
