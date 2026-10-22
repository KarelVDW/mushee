import { NetworkError } from './api'

/** The form field an auth error belongs under, when it is about one field. */
export type AuthErrorField = 'email' | 'password' | 'code'

/**
 * The next step an auth error hands over, which the form renders as a link or button:
 * - `reset` — reset the password (to /reset-password, the email carried over);
 * - `sign-in` — sign in instead (to /login, the email and ?next= carried over);
 * - `request-new-link` — back to the reset form's request stage for a fresh link;
 * - `resend` — send a new verification code.
 */
export type AuthErrorAction = 'reset' | 'sign-in' | 'request-new-link' | 'resend'

/** What an auth form shows for a failure: Solkey's words, and where and how to go on. */
export interface AuthErrorMessage {
    readonly message: string
    /** Show the message under this field instead of in the form's alert. */
    readonly field?: AuthErrorField
    /** The next step to offer beside the message. */
    readonly action?: AuthErrorAction
}

/**
 * Solkey's copy for the auth library's errors (better-auth's `error.code`), for sign-in,
 * sign-up, password reset and email verification. The library's `error.message` is
 * never shown: it is developer English ("Invalid OTP", "User already exists. Use another
 * email.") and often points the wrong way. Every message says what happened and what
 * to do next; an unknown code gets a plain fallback rather than the server's string.
 *
 * `AuthErrorCopy.for(error)` takes whatever the auth call produced: the `error` of a
 * better-auth result, a bare code (the `?error=INVALID_TOKEN` a reset link lands with),
 * or a thrown network failure.
 */
export class AuthErrorCopy {
    /** The connection failed before the server could answer. */
    static readonly NETWORK: AuthErrorMessage = { message: "Couldn't reach Solkey. Check your connection and try again." }

    /** Any failure without its own line — never blames a side, since it may be either. */
    static readonly FALLBACK: AuthErrorMessage = { message: 'Something went wrong. Try again in a moment.' }

    private static readonly BY_CODE: ReadonlyMap<string, AuthErrorMessage> = (() => {
        const alreadyExists: AuthErrorMessage = {
            message: "There's already an account with this email. Sign in instead?",
            action: 'sign-in',
        }
        return new Map<string, AuthErrorMessage>([
            [
                'INVALID_EMAIL_OR_PASSWORD',
                { message: "That email and password don't match. Check for a typo, or reset your password.", action: 'reset' },
            ],
            ['USER_ALREADY_EXISTS', alreadyExists],
            ['USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL', alreadyExists],
            ['PASSWORD_TOO_SHORT', { message: 'Use at least 8 characters.', field: 'password' }],
            ['INVALID_EMAIL', { message: "That email doesn't look quite right.", field: 'email' }],
            [
                'INVALID_TOKEN',
                { message: 'This reset link has expired or was already used. Ask for a new one below.', action: 'request-new-link' },
            ],
            ['INVALID_OTP', { message: "That code doesn't match. Check the newest email from us, or send a new code.", field: 'code' }],
            ['OTP_EXPIRED', { message: 'That code has expired. Send a new one.', action: 'resend' }],
            ['TOO_MANY_ATTEMPTS', { message: 'Too many tries. Send a new code to start again.', action: 'resend' }],
        ])
    })()

    /**
     * The copy for an auth failure: a better-auth error, a bare error code, or a thrown
     * network failure — the app's NetworkError, or the TypeError `fetch` rejects with
     * when the request never reaches the server (better-auth's client lets it through).
     */
    static for(error: unknown): AuthErrorMessage {
        if (error instanceof NetworkError || error instanceof TypeError) return AuthErrorCopy.NETWORK
        const code = typeof error === 'string' ? error : AuthErrorCopy.codeOf(error)
        return (code && AuthErrorCopy.BY_CODE.get(code)) || AuthErrorCopy.FALLBACK
    }

    /** The machine-readable code of an error object, if it carries one. */
    private static codeOf(error: unknown): string | undefined {
        if (typeof error !== 'object' || error === null || !('code' in error)) return undefined
        return typeof error.code === 'string' ? error.code : undefined
    }
}
