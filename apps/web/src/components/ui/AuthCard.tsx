'use client'

import Link from 'next/link'
import { type FormEvent, type ReactNode } from 'react'

import { Wordmark } from './Brand'
import { PrimaryButton, TertiaryButton } from './Buttons'
import { Icon } from './Icon'
import { TextField } from './Inputs'

type AuthMode = 'signin' | 'signup'

interface AuthCardProps {
    mode: AuthMode
    /** Optional banner above the form (e.g. closed-beta note). */
    notice?: ReactNode
    name?: string
    email: string
    password: string
    showPassword: boolean
    loading?: boolean
    error?: string | null
    onNameChange?: (v: string) => void
    onEmailChange: (v: string) => void
    onPasswordChange: (v: string) => void
    onToggleShowPassword: () => void
    onSubmit: (e: FormEvent) => void
}

export function AuthCard(props: AuthCardProps) {
    const isSignup = props.mode === 'signup'
    return (
        <main className="w-full max-w-230 mx-auto bg-surface-container-lowest rounded-2xl editorial-shadow flex overflow-hidden min-h-145 relative">
            <div className="absolute -top-[20%] -right-[10%] w-1/2 h-1/2 bg-primary-container/20 rounded-full blur-[96px] pointer-events-none" />
            <BrandPanel mode={props.mode} />
            <FormPanel {...props} isSignup={isSignup} />
        </main>
    )
}

function BrandPanel({ mode }: { mode: AuthMode }) {
    const isSignup = mode === 'signup'
    return (
        <section className="w-[42%] bg-surface-container-high p-12 flex flex-col justify-between relative overflow-hidden">
            <Wordmark size={32} />
            <div className="flex flex-col gap-4">
                <h1 className="font-serif font-normal italic text-[48px] leading-none tracking-[-0.01em] text-on-surface m-0">
                    {isSignup ? (
                        <>
                            Compose
                            <br />
                            without friction.
                        </>
                    ) : (
                        <>
                            Welcome
                            <br />
                            back.
                        </>
                    )}
                </h1>
                <p className="font-body font-normal text-[14px] leading-normal text-on-surface-variant max-w-70 m-0">
                    A simple, fast score editor for the music in your head.
                </p>
            </div>
        </section>
    )
}

function FormPanel({
    mode,
    notice,
    name,
    email,
    password,
    showPassword,
    loading,
    error,
    onNameChange,
    onEmailChange,
    onPasswordChange,
    onToggleShowPassword,
    onSubmit,
    isSignup,
}: AuthCardProps & { isSignup: boolean }) {
    return (
        <section className="flex-1 p-14 flex flex-col relative z-2">
            <div className="max-w-90 w-full mx-auto flex-1 flex flex-col">
                <Tabs mode={mode} />

                <form onSubmit={onSubmit} className="flex flex-col gap-5 flex-1">
                    <div className="flex flex-col gap-4.5 flex-1 justify-center">
                        {notice && (
                            <div className="bg-secondary-soft text-on-secondary-soft rounded-md px-4 py-3 font-body font-normal text-[13px] leading-normal">
                                {notice}
                            </div>
                        )}
                        {isSignup && <TextField label="Your name" value={name ?? ''} onChange={onNameChange} placeholder="Anya Mokri" />}
                        <TextField label="Email" value={email} onChange={onEmailChange} placeholder="you@email.com" type="email" />
                        <TextField
                            label="Password"
                            value={password}
                            onChange={onPasswordChange}
                            type={showPassword ? 'text' : 'password'}
                            placeholder="••••••••••••"
                            rightSlot={
                                <button
                                    type="button"
                                    onClick={onToggleShowPassword}
                                    aria-label="Toggle password visibility"
                                    className="bg-transparent border-0 text-outline cursor-pointer p-1 inline-flex">
                                    <Icon name={showPassword ? 'eye-off' : 'eye'} size={18} />
                                </button>
                            }
                        />
                        {!isSignup && (
                            <div className="flex justify-end -mt-2">
                                <Link href="/reset-password" className="no-underline">
                                    <TertiaryButton>Forgot password?</TertiaryButton>
                                </Link>
                            </div>
                        )}
                        {error && <span className="font-body font-medium text-[12px] leading-[1.4] text-error">{error}</span>}
                    </div>

                    <div className="flex flex-col gap-3.5 pt-2">
                        <PrimaryButton size="lg" type="submit" emphasis="pop" fullWidth disabled={loading}>
                            {loading ? (isSignup ? 'Creating account…' : 'Signing in…') : isSignup ? 'Create account' : 'Sign in'}
                        </PrimaryButton>
                        <SwitchModeRow mode={mode} />
                    </div>
                </form>
            </div>
        </section>
    )
}

function Tabs({ mode }: { mode: AuthMode }) {
    return (
        <div className="flex items-end gap-6.5 pb-2 mb-8">
            <ModeTab href="/login" label="Sign in" active={mode === 'signin'} />
            <ModeTab href="/signup" label="Create account" active={mode === 'signup'} />
        </div>
    )
}

function ModeTab({ href, label, active }: { href: string; label: string; active: boolean }) {
    return (
        <Link
            href={href}
            className={[
                'no-underline font-body font-medium text-[14px] leading-none pb-2 whitespace-nowrap',
                active ? 'text-on-surface border-b-[3px] border-primary-container' : 'text-on-surface-variant border-b-[3px] border-transparent',
            ].join(' ')}>
            {label}
        </Link>
    )
}

function SwitchModeRow({ mode }: { mode: AuthMode }) {
    const isSignup = mode === 'signup'
    return (
        <div className="flex justify-between items-center">
            <span className="font-body font-normal text-[13px] leading-none text-on-surface-variant">
                {isSignup ? 'Already have an account?' : 'New here?'}
            </span>
            <Link href={isSignup ? '/login' : '/signup'} className="no-underline">
                <TertiaryButton>{isSignup ? 'Sign in' : 'Create one'}</TertiaryButton>
            </Link>
        </div>
    )
}

export function AuthShell({ children }: { children: ReactNode }) {
    return <div className="min-h-screen flex items-center justify-center p-8 bg-surface">{children}</div>
}
