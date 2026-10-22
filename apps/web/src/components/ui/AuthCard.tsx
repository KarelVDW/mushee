'use client'

import { Alert, PrimaryButton, TertiaryButton, TextField, Wordmark } from '@mushee/ui'
import Link from 'next/link'
import { type FormEvent, type ReactNode, useState } from 'react'

import type { AuthErrorAction, AuthErrorMessage } from '@/lib/AuthErrorCopy'
import { withNext } from '@/lib/nextPath'
import { BETA_MODE } from '@/lib/plans'

import { SIGNUP_PASSWORD_HINT } from './Password'
import { PasswordField } from './PasswordField'

type AuthMode = 'signin' | 'signup'

const AUTH_COPY: Record<
    AuthMode,
    { headline: [string, string]; submit: string; submitting: string; switchPrompt: string; switchLabel: string; switchHref: string }
> = {
    signin: {
        headline: ['Welcome', 'back.'],
        submit: 'Sign in',
        submitting: 'Signing in…',
        switchPrompt: 'New here?',
        switchLabel: 'Create one',
        switchHref: '/signup',
    },
    signup: {
        headline: ['Notation', 'made easy.'],
        submit: 'Create account',
        submitting: 'Creating account…',
        switchPrompt: 'Already have an account?',
        switchLabel: 'Sign in',
        switchHref: '/login',
    },
}

/** What the visitor already typed, handed from one auth form to the next. */
export interface AuthPrefillFields {
    email?: string
    name?: string
}

/**
 * What one auth form hands the next when it sends the visitor on — "Sign in instead",
 * "reset your password", onboarding's "Start over" — so they needn't type their email or
 * name again. Held in memory for the client-side navigation that follows, never put in the
 * URL, where an address would end up in the history, server logs and analytics page views.
 * A form reads it when it mounts; submitting a form clears it.
 */
export class AuthPrefill {
    private static fields: AuthPrefillFields = {}

    static offer(fields: AuthPrefillFields): void {
        AuthPrefill.fields = { ...fields }
    }

    static read(): AuthPrefillFields {
        return AuthPrefill.fields
    }

    static clear(): void {
        AuthPrefill.fields = {}
    }
}

interface AuthFrameProps {
    /** The display headline, set on two lines. */
    headline: [string, string]
    tagline: string
    /**
     * Gives phones a compact brand row instead — the wordmark and this one line, with
     * the headline and tagline from md up. Left out, the panel stacks and keeps its
     * (smaller) headline and tagline on phones too.
     */
    mobileTagline?: string
    /** The form column's content. */
    children: ReactNode
}

/** The auth pages' card: brand panel (wordmark, serif headline, tagline) beside the form column. */
export function AuthFrame({ headline, tagline, mobileTagline, children }: AuthFrameProps) {
    return (
        <main className="w-full max-w-230 mx-auto bg-surface-container-lowest rounded-xl editorial-shadow flex flex-col md:flex-row overflow-hidden md:min-h-145 relative">
            <div className="absolute -top-[20%] -right-[10%] w-1/2 h-1/2 bg-primary-container/20 rounded-full blur-[96px] pointer-events-none" />
            <BrandPanel headline={headline} tagline={tagline} mobileTagline={mobileTagline} />
            <section className="flex-1 p-6 py-8 md:p-14 flex flex-col relative z-2">
                <div className="max-w-90 w-full mx-auto flex-1 flex flex-col">{children}</div>
            </section>
        </main>
    )
}

function BrandPanel({ headline, tagline, mobileTagline }: Omit<AuthFrameProps, 'children'>) {
    const compact = mobileTagline !== undefined
    return (
        <section
            className={[
                'md:w-[42%] bg-surface-container-high p-6 md:p-12 justify-between gap-4',
                compact ? 'flex flex-row md:flex-col items-center md:items-stretch relative overflow-hidden' : 'flex flex-col',
            ].join(' ')}>
            {/* The way home: the only other one was the browser's Back button. */}
            <Link
                href="/"
                aria-label="Solkey home"
                className={[
                    'no-underline inline-flex items-center rounded-sm focus-ring pointer-coarse:min-h-10',
                    compact ? 'md:self-start' : 'self-start',
                ].join(' ')}>
                <Wordmark size={32} />
            </Link>
            <div className={compact ? 'flex flex-col gap-4 max-md:hidden' : 'flex flex-col gap-4'}>
                <h1
                    className={[
                        'font-serif font-normal italic leading-none tracking-[-0.01em] text-on-surface m-0',
                        compact ? 'text-[48px]' : 'text-[28px] md:text-[48px]',
                    ].join(' ')}>
                    {headline[0]}
                    <br />
                    {headline[1]}
                </h1>
                <p className="font-body font-normal text-[14px] leading-normal text-on-surface-variant max-w-70 m-0">{tagline}</p>
            </div>
            {compact && (
                <p className="md:hidden font-serif italic text-[17px] leading-snug text-on-surface-variant m-0 text-right">
                    {mobileTagline}
                </p>
            )}
        </section>
    )
}

export interface AuthCredentials {
    /** Empty when signing in — only the signup form asks for it. */
    name: string
    email: string
    password: string
}

interface AuthCardProps {
    mode: AuthMode
    /** Optional note above the form (the closed-beta note, the "Signed out" after a declined reactivation); announced politely. */
    notice?: ReactNode
    loading?: boolean
    /** Blocks submission for a reason other than loading (e.g. a CAPTCHA still to be solved). */
    submitDisabled?: boolean
    /** Rendered between the fields and the submit button (the signup CAPTCHA). */
    beforeSubmit?: ReactNode
    /**
     * The last failure, in Solkey's words (AuthErrorCopy — never the server's message): under
     * its field when it names one, otherwise in the alert, with its next step as a link.
     */
    error?: AuthErrorMessage | null
    /** Where the visitor is headed after auth (?next=), carried over when they switch between sign-in and sign-up. */
    next?: string
    onSubmit: (credentials: AuthCredentials) => void
}

/** The sign-in / sign-up form in its AuthFrame. It owns the fields; the page owns what submitting does. */
export function AuthCard({ mode, notice, loading, submitDisabled, beforeSubmit, error, next, onSubmit }: AuthCardProps) {
    const copy = AUTH_COPY[mode]
    const isSignup = mode === 'signup'
    // A form that sent the visitor here may have handed over what they already typed.
    const [name, setName] = useState(() => (isSignup ? (AuthPrefill.read().name ?? '') : ''))
    const [email, setEmail] = useState(() => AuthPrefill.read().email ?? '')
    const [password, setPassword] = useState('')

    const submit = (e: FormEvent) => {
        e.preventDefault()
        AuthPrefill.clear()
        onSubmit({ name, email, password })
    }

    const fieldError = (field: 'email' | 'password') => (error?.field === field ? error.message : undefined)
    const alert = error && error.field !== 'email' && error.field !== 'password' ? error : null
    const fieldMessage = fieldError('email') ?? fieldError('password')

    return (
        <AuthFrame headline={copy.headline} tagline="The fastest way to get a melody on the page." mobileTagline={copy.headline.join(' ')}>
            <Tabs mode={mode} next={next} />

            {/* Always mounted, so a notice that appears later (after a declined reactivation) is read out. */}
            <div role="status">
                {notice && (
                    <div className="mb-5 bg-secondary-soft text-on-secondary-soft rounded-md px-4 py-3 font-body font-normal text-[13px] leading-normal">
                        {notice}
                    </div>
                )}
            </div>

            {/* method="post": a submit that lands before hydration falls back to a native submit,
                and a GET would put the email and password in the URL (history, server logs). */}
            <form method="post" onSubmit={submit} className="flex flex-col gap-5 flex-1">
                <div className="flex flex-col gap-4.5 flex-1 justify-center">
                    {isSignup && (
                        <TextField
                            label="Your name"
                            value={name}
                            onChange={setName}
                            placeholder="Anya Mokri"
                            autoComplete="name"
                            name="name"
                            required
                        />
                    )}
                    <TextField
                        label="Email"
                        value={email}
                        onChange={setEmail}
                        placeholder="you@email.com"
                        type="email"
                        autoComplete="email"
                        autoCapitalize="none"
                        name="email"
                        required
                        error={fieldError('email')}
                    />
                    <PasswordField
                        label="Password"
                        value={password}
                        onChange={setPassword}
                        autoComplete={isSignup ? 'new-password' : 'current-password'}
                        name="password"
                        required
                        hint={isSignup ? SIGNUP_PASSWORD_HINT : undefined}
                        error={fieldError('password')}
                    />
                    {!isSignup && (
                        <div className="flex justify-end -mt-2">
                            <TertiaryButton href={withNext('/reset-password', next)} onClick={() => AuthPrefill.offer({ email })}>
                                Forgot password?
                            </TertiaryButton>
                        </div>
                    )}
                    {alert && (
                        <Alert>
                            <AuthErrorText error={alert} email={email} next={next} />
                        </Alert>
                    )}
                    <FieldErrorAnnouncement label={error?.field === 'email' ? 'Email' : 'Password'} message={fieldMessage} />
                </div>

                <div className="flex flex-col gap-3.5 pt-2">
                    {beforeSubmit}
                    <PrimaryButton size="lg" type="submit" emphasis="pop" fullWidth disabled={loading || submitDisabled}>
                        {loading ? copy.submitting : copy.submit}
                    </PrimaryButton>
                    {isSignup && <SignupTerms />}
                    <div className="flex justify-between items-center">
                        <span className="font-body font-normal text-[13px] leading-none text-on-surface-variant">{copy.switchPrompt}</span>
                        <TertiaryButton href={withNext(copy.switchHref, next)} onClick={() => AuthPrefill.offer({ email })}>
                            {copy.switchLabel}
                        </TertiaryButton>
                    </div>
                </div>
            </form>
        </AuthFrame>
    )
}

/**
 * Reads a field's error out the moment it arrives, naming the field ("Password: Use at least 8
 * characters."). The message under the field is tied to it by aria-describedby, which a screen
 * reader only reads when the field next takes focus — and the form leaves focus where it was.
 * Always mounted and visually hidden; the page clears its error before each try, so a repeat
 * of the same problem is read out again.
 */
export function FieldErrorAnnouncement({ label, message }: { label: string; message?: string }) {
    return (
        <div aria-live="polite" className="sr-only">
            {message ? `${label}: ${message}` : ''}
        </div>
    )
}

/** What signing up costs (nothing) and what it agrees to, under the Create account button. */
function SignupTerms() {
    return (
        <div className="flex flex-col gap-1 text-center font-body font-normal text-[12px] leading-[1.4] text-on-surface-variant">
            <p className="m-0">{BETA_MODE ? 'Free during the beta.' : 'Free to start — no card needed.'}</p>
            <p className="m-0">
                By creating an account you agree to the{' '}
                <Link href="/terms" className={INLINE_LINK}>
                    Terms
                </Link>{' '}
                and{' '}
                <Link href="/privacy" className={INLINE_LINK}>
                    Privacy policy
                </Link>
                .
            </p>
        </div>
    )
}

/** An inline text link inside a sentence; inherits the sentence's colour on tinted surfaces (the alert). */
const INLINE_LINK = 'text-inherit font-medium underline underline-offset-2 hover:no-underline rounded-sm focus-ring'

/** The words of an error message that become its next step's link, and where that link goes. */
const ACTION_LINKS: Partial<Record<AuthErrorAction, { phrase: string; path: string }>> = {
    reset: { phrase: 'reset your password', path: '/reset-password' },
    'sign-in': { phrase: 'Sign in instead', path: '/login' },
}

/**
 * An error message with its next step linked in place ("…, or reset your password." /
 * "Sign in instead?"). Following the link hands the typed email to the next form, and the
 * ?next= destination rides along.
 */
function AuthErrorText({ error, email, next }: { error: AuthErrorMessage; email: string; next?: string }) {
    const link = error.action ? ACTION_LINKS[error.action] : undefined
    const at = link ? error.message.indexOf(link.phrase) : -1
    if (!link || at < 0) return <>{error.message}</>
    return (
        <>
            {error.message.slice(0, at)}
            <Link href={withNext(link.path, next)} onClick={() => AuthPrefill.offer({ email })} className={INLINE_LINK}>
                {link.phrase}
            </Link>
            {error.message.slice(at + link.phrase.length)}
        </>
    )
}

function Tabs({ mode, next }: { mode: AuthMode; next?: string }) {
    return (
        <div className="flex items-end gap-6.5 pb-2 mb-8">
            <ModeTab href={withNext('/login', next)} label="Sign in" active={mode === 'signin'} />
            <ModeTab href={withNext('/signup', next)} label="Create account" active={mode === 'signup'} />
        </div>
    )
}

function ModeTab({ href, label, active }: { href: string; label: string; active: boolean }) {
    return (
        <Link
            href={href}
            aria-current={active ? 'page' : undefined}
            className={[
                'no-underline font-body font-medium text-[14px] leading-none pb-2 whitespace-nowrap',
                active
                    ? 'text-on-surface border-b-[3px] border-primary-container'
                    : 'text-on-surface-variant border-b-[3px] border-transparent',
            ].join(' ')}>
            {label}
        </Link>
    )
}

export function AuthShell({ children }: { children: ReactNode }) {
    return <div className="min-h-dvh flex items-center justify-center p-4 py-6 sm:p-8 bg-surface">{children}</div>
}
