'use client'

import { Alert, PrimaryButton, TertiaryButton, TextField, Wordmark } from '@mushee/ui'
import Link from 'next/link'
import { type FormEvent, type ReactNode, useState } from 'react'

import { withNext } from '@/lib/nextPath'

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
            <Wordmark size={32} />
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
    /** Optional banner above the form (e.g. closed-beta note). */
    notice?: ReactNode
    loading?: boolean
    /** Blocks submission for a reason other than loading (e.g. a CAPTCHA still to be solved). */
    submitDisabled?: boolean
    /** Rendered between the fields and the submit button (the signup CAPTCHA). */
    beforeSubmit?: ReactNode
    error?: string | null
    /** Where the visitor is headed after auth (?next=), carried over when they switch between sign-in and sign-up. */
    next?: string
    onSubmit: (credentials: AuthCredentials) => void
}

/** The sign-in / sign-up form in its AuthFrame. It owns the fields; the page owns what submitting does. */
export function AuthCard({ mode, notice, loading, submitDisabled, beforeSubmit, error, next, onSubmit }: AuthCardProps) {
    const copy = AUTH_COPY[mode]
    const isSignup = mode === 'signup'
    const [name, setName] = useState('')
    const [email, setEmail] = useState('')
    const [password, setPassword] = useState('')

    const submit = (e: FormEvent) => {
        e.preventDefault()
        onSubmit({ name, email, password })
    }

    return (
        <AuthFrame headline={copy.headline} tagline="The fastest way to get a melody on the page." mobileTagline={copy.headline.join(' ')}>
            <Tabs mode={mode} next={next} />

            <form onSubmit={submit} className="flex flex-col gap-5 flex-1">
                <div className="flex flex-col gap-4.5 flex-1 justify-center">
                    {notice && (
                        <div className="bg-secondary-soft text-on-secondary-soft rounded-md px-4 py-3 font-body font-normal text-[13px] leading-normal">
                            {notice}
                        </div>
                    )}
                    {isSignup && <TextField label="Your name" value={name} onChange={setName} placeholder="Anya Mokri" />}
                    <TextField label="Email" value={email} onChange={setEmail} placeholder="you@email.com" type="email" />
                    <PasswordField label="Password" value={password} onChange={setPassword} />
                    {!isSignup && (
                        <div className="flex justify-end -mt-2">
                            <TertiaryButton href="/reset-password">Forgot password?</TertiaryButton>
                        </div>
                    )}
                    {error && <Alert>{error}</Alert>}
                </div>

                <div className="flex flex-col gap-3.5 pt-2">
                    {beforeSubmit}
                    <PrimaryButton size="lg" type="submit" emphasis="pop" fullWidth disabled={loading || submitDisabled}>
                        {loading ? copy.submitting : copy.submit}
                    </PrimaryButton>
                    <div className="flex justify-between items-center">
                        <span className="font-body font-normal text-[13px] leading-none text-on-surface-variant">{copy.switchPrompt}</span>
                        <TertiaryButton href={withNext(copy.switchHref, next)}>{copy.switchLabel}</TertiaryButton>
                    </div>
                </div>
            </form>
        </AuthFrame>
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
