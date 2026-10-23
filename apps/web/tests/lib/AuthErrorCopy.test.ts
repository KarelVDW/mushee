import { describe, expect, it } from 'vitest'

import { NetworkError } from '@/lib/api'
import { AuthErrorCopy } from '@/lib/AuthErrorCopy'

/** A better-auth client error as the auth calls return it: the code plus the library's own English. */
function authError(code: string, message = 'Library message'): { code: string; message: string; status: number; statusText: string } {
    return { code, message, status: 400, statusText: 'BAD_REQUEST' }
}

describe('AuthErrorCopy', () => {
    it('turns a wrong email or password into a next step: reset', () => {
        expect(AuthErrorCopy.for(authError('INVALID_EMAIL_OR_PASSWORD', 'Invalid email or password'))).toEqual({
            message: "That email and password don't match. Check for a typo, or reset your password.",
            kind: 'form',
            action: 'reset',
        })
    })

    it('points an existing account at sign-in, for both codes better-auth uses', () => {
        const expected = { message: "There's already an account with this email. Sign in instead?", kind: 'form', action: 'sign-in' }
        expect(AuthErrorCopy.for(authError('USER_ALREADY_EXISTS'))).toEqual(expected)
        expect(AuthErrorCopy.for(authError('USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL', 'User already exists. Use another email.'))).toEqual(
            expected,
        )
    })

    it('puts field problems under their field', () => {
        expect(AuthErrorCopy.for(authError('PASSWORD_TOO_SHORT', 'Password too short'))).toEqual({
            message: 'Use at least 8 characters.',
            kind: 'form',
            field: 'password',
        })
        expect(AuthErrorCopy.for(authError('INVALID_EMAIL', 'Invalid email'))).toEqual({
            message: "That email doesn't look quite right.",
            kind: 'form',
            field: 'email',
        })
        expect(AuthErrorCopy.for(authError('INVALID_OTP', 'Invalid OTP'))).toEqual({
            message: "That code doesn't match. Check the newest email from us, or send a new code.",
            kind: 'form',
            field: 'code',
        })
    })

    it('sends a used or expired reset link back for a new one', () => {
        expect(AuthErrorCopy.for(authError('INVALID_TOKEN', 'Invalid token'))).toEqual({
            message: 'This reset link has expired or was already used. Ask for a new one below.',
            kind: 'form',
            action: 'request-new-link',
        })
    })

    it('offers a new code when the old one expired or was tried too often', () => {
        expect(AuthErrorCopy.for(authError('OTP_EXPIRED'))).toEqual({
            message: 'That code has expired. Send a new one.',
            kind: 'form',
            action: 'resend',
        })
        expect(AuthErrorCopy.for(authError('TOO_MANY_ATTEMPTS'))).toEqual({
            message: 'Too many tries. Send a new code to start again.',
            kind: 'form',
            action: 'resend',
        })
    })

    it('reads a bare code, like the ?error= a reset link lands with', () => {
        expect(AuthErrorCopy.for('INVALID_TOKEN').action).toBe('request-new-link')
        expect(AuthErrorCopy.for('INVALID_OTP').field).toBe('code')
        expect(AuthErrorCopy.for('SOMETHING_ELSE')).toBe(AuthErrorCopy.FALLBACK)
        expect(AuthErrorCopy.for('')).toBe(AuthErrorCopy.FALLBACK)
    })

    it('says the connection failed for a network failure', () => {
        expect(AuthErrorCopy.for(new NetworkError(new TypeError('Failed to fetch')))).toEqual({
            message: "Couldn't reach Solkey. Check your connection and try again.",
            kind: 'fault',
        })
        // fetch rejects with a bare TypeError when the request never leaves the device.
        expect(AuthErrorCopy.for(new TypeError('Failed to fetch'))).toBe(AuthErrorCopy.NETWORK)
        expect(AuthErrorCopy.for(new TypeError('Load failed'))).toBe(AuthErrorCopy.NETWORK)
    })

    it('falls back to plain copy for unknown codes and shapes', () => {
        // Unknown, so never blamed on the user: the fault tier.
        const fallback = { message: 'Something went wrong. Try again in a moment.', kind: 'fault' }
        expect(AuthErrorCopy.for(authError('EMAIL_NOT_VERIFIED', 'Email not verified'))).toEqual(fallback)
        expect(AuthErrorCopy.for({ message: 'Internal Server Error', status: 500, statusText: 'Internal Server Error' })).toEqual(fallback)
        expect(AuthErrorCopy.for({ code: 42 })).toEqual(fallback)
        expect(AuthErrorCopy.for(new Error('boom'))).toEqual(fallback)
        expect(AuthErrorCopy.for(null)).toEqual(fallback)
        expect(AuthErrorCopy.for(undefined)).toEqual(fallback)
        expect(AuthErrorCopy.for(404)).toEqual(fallback)
    })

    it('does not mistake inherited object keys for codes', () => {
        expect(AuthErrorCopy.for('constructor')).toBe(AuthErrorCopy.FALLBACK)
        expect(AuthErrorCopy.for(authError('toString'))).toBe(AuthErrorCopy.FALLBACK)
    })

    it("never shows the library's own message", () => {
        const raw = 'RAW LIBRARY TEXT'
        const codes = [
            'INVALID_EMAIL_OR_PASSWORD',
            'USER_ALREADY_EXISTS',
            'USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL',
            'PASSWORD_TOO_SHORT',
            'INVALID_EMAIL',
            'INVALID_TOKEN',
            'INVALID_OTP',
            'OTP_EXPIRED',
            'TOO_MANY_ATTEMPTS',
            'UNKNOWN',
        ]
        for (const code of codes) {
            const copy = AuthErrorCopy.for(authError(code, raw))
            expect(copy.message).not.toContain(raw)
            // Solkey's voice: a full sentence, ending with a period or a question mark.
            expect(copy.message).toMatch(/^[A-Z].*[.?]$/)
        }
    })
})
