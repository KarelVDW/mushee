'use client'

import { Alert, PrimaryButton, TertiaryButton, TextField, Wordmark } from '@mushee/ui'
import Link from 'next/link'
import { type FormEvent, type ReactNode, useState } from 'react'

import { DemoSheetStill } from '@/components/DemoSheet'
import { Haze } from '@/components/marketing/Haze'
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
     * The headline as one line, for the phones' compact brand strip (the wordmark and this
     * line, which is then the page's h1); the two-line headline and the tagline take over
     * from md. Left out, the strip reads the headline on one line.
     */
    mobileTagline?: string
    /** The form column's content. */
    children: ReactNode
}

/**
 * The auth pages' card: brand panel (wordmark, the finished demo sheet on wide screens, serif
 * headline, tagline) beside the form column, which holds the one cyan haze so it never tints the
 * grey panel.
 */
export function AuthFrame({ headline, tagline, mobileTagline, children }: AuthFrameProps) {
    return (
        <main className="w-full max-w-230 mx-auto bg-surface-container-lowest rounded-xl editorial-shadow flex flex-col md:flex-row overflow-hidden md:min-h-145">
            <BrandPanel headline={headline} tagline={tagline} mobileTagline={mobileTagline} />
            <section className="relative overflow-hidden flex-1 px-5 py-7 md:p-14 flex flex-col">
                <Haze placement="top-right" />
                <div className="relative z-2 max-w-90 w-full mx-auto flex-1 flex flex-col">{children}</div>
            </section>
        </main>
    )
}

/**
 * The brand panel. Phones get a compact strip — the wordmark and the headline on one line;
 * from md it stacks the wordmark over the two-line serif headline and the tagline, and from lg
 * the finished demo sheet sits between them: the product the landing page just showed. One h1
 * at every width.
 */
function BrandPanel({ headline, tagline, mobileTagline }: Omit<AuthFrameProps, 'children'>) {
    return (
        <section className="md:w-[42%] bg-surface-container-high p-6 md:p-12 flex flex-row md:flex-col items-center md:items-stretch justify-between gap-4">
            {/* The way home: the only other one was the browser's Back button. */}
            <Link
                href="/"
                aria-label="Solkey home"
                className="no-underline inline-flex items-center rounded-sm focus-ring pointer-coarse:min-h-10 md:self-start">
                <Wordmark size={32} />
            </Link>
            <div className="max-lg:hidden my-auto py-8">
                <DemoSheetStill />
                <p className="m-0 mt-3 font-body text-[12px] leading-[1.4] text-on-surface-variant">Someone humming Frère Jacques.</p>
            </div>
            <div className="flex flex-col gap-4 min-w-0">
                <h1
                    className={[
                        'm-0 font-serif font-normal italic',
                        'max-md:text-[17px] max-md:leading-snug max-md:text-right max-md:text-on-surface-variant',
                        'md:text-[48px] md:leading-none md:tracking-[-0.01em] md:text-on-surface',
                    ].join(' ')}>
                    <span className="md:hidden">{mobileTagline ?? headline.join(' ')}</span>
                    <span className="max-md:hidden">
                        {headline[0]}
                        <br />
                        {headline[1]}
                    </span>
                </h1>
                <p className="max-md:hidden font-body font-normal text-[14px] leading-normal text-on-surface-variant max-w-75 m-0">
                    {tagline}
                </p>
            </div>
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
                and a GET would put the email and password in the URL (history, server logs).
                Top-anchored: an alert only pushes the button down, never the fields being typed in. */}
            <form method="post" onSubmit={submit} className="flex flex-col flex-1">
                <div className="flex flex-col gap-4.5">
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
                        // A typo or an existing account is the user's to fix: the quiet form tier. A
                        // network or server failure keeps the fault slab.
                        <Alert tone={alert.kind}>
                            <AuthErrorText error={alert} email={email} next={next} />
                        </Alert>
                    )}
                    <FieldErrorAnnouncement label={error?.field === 'email' ? 'Email' : 'Password'} message={fieldMessage} />
                </div>

                <div className="flex flex-col gap-3.5 mt-7">
                    {beforeSubmit}
                    <PrimaryButton size="lg" type="submit" emphasis="pop" fullWidth disabled={loading || submitDisabled}>
                        {loading ? copy.submitting : copy.submit}
                    </PrimaryButton>
                    {isSignup && <SignupTerms />}
                </div>

                {/* One centred line at the column's foot: the prompt and its answer read together. */}
                <p className="m-0 mt-auto pt-6 flex justify-center items-center gap-1.5 font-body text-[13px] text-on-surface-variant">
                    {copy.switchPrompt}{' '}
                    <TertiaryButton href={withNext(copy.switchHref, next)} onClick={() => AuthPrefill.offer({ email })}>
                        {copy.switchLabel}
                    </TertiaryButton>
                </p>
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
            {/* The legal names never break across lines. */}
            <p className="m-0">
                By creating an account you agree to the{' '}
                <Link href="/terms" className={`${INLINE_LINK} whitespace-nowrap`}>
                    Terms
                </Link>{' '}
                and{' '}
                <Link href="/privacy" className={`${INLINE_LINK} whitespace-nowrap`}>
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

/** A Sign in / Create account tab: the nav tabs' focus ring, hover and 40px coarse hit area, over its 3px underline. */
function ModeTab({ href, label, active }: { href: string; label: string; active: boolean }) {
    return (
        <Link
            href={href}
            aria-current={active ? 'page' : undefined}
            className={[
                'relative no-underline font-body font-medium text-[14px] leading-none pb-2 whitespace-nowrap rounded-sm focus-ring',
                'transition-colors duration-150 ease-solkey',
                "pointer-coarse:after:absolute pointer-coarse:after:-inset-x-2 pointer-coarse:after:-inset-y-3 pointer-coarse:after:content-['']",
                active
                    ? 'text-on-surface border-b-[3px] border-primary-container'
                    : 'text-on-surface-variant hover:text-on-surface border-b-[3px] border-transparent',
            ].join(' ')}>
            {label}
        </Link>
    )
}

/**
 * The auth pages' page: the card top-anchored (from 12% of the viewport on wide screens), so a
 * card that grows — an alert landing — extends downward and never shifts what is already there.
 */
export function AuthShell({ children }: { children: ReactNode }) {
    return (
        <div className="min-h-dvh flex items-start justify-center px-4 pb-6 pt-[max(1.5rem,env(safe-area-inset-top))] sm:px-8 sm:pb-8 md:pt-[max(2rem,12dvh)] bg-surface">
            {children}
        </div>
    )
}
