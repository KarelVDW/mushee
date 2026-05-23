'use client'

import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { type FormEvent, Suspense, useEffect, useState } from 'react'

import { AuthShell, Eyebrow, Icon, ModalTitle, PrimaryButton, SubHeadline, TertiaryButton, TextField, Wordmark } from '@/components/ui'
import { requestPasswordReset, resetPassword } from '@/lib/auth-client'

type Stage = 'request' | 'sent' | 'set-new' | 'done'
const STAGES: Stage[] = ['request', 'sent', 'set-new', 'done']

const PW_LABELS = ['Too short', 'Weak', 'OK', 'Strong', 'Strong']
function scorePassword(pw: string): number {
    if (!pw) return 0
    let s = 0
    if (pw.length >= 8) s++
    if (pw.length >= 12) s++
    if (/[A-Z]/.test(pw) && /[a-z]/.test(pw)) s++
    if (/\d/.test(pw) || /[^A-Za-z0-9]/.test(pw)) s++
    return Math.min(s, 4)
}

export default function PasswordResetPage() {
    return (
        <Suspense fallback={null}>
            <PasswordResetPageInner />
        </Suspense>
    )
}

function PasswordResetPageInner() {
    const router = useRouter()
    const searchParams = useSearchParams()
    const tokenFromUrl = searchParams.get('token')
    const errorFromUrl = searchParams.get('error')

    const [stage, setStage] = useState<Stage>(tokenFromUrl ? 'set-new' : 'request')
    const [email, setEmail] = useState('')
    const [pw, setPw] = useState('')
    const [pw2, setPw2] = useState('')
    const [showPw, setShowPw] = useState(false)
    const [resent, setResent] = useState(false)
    const [submitting, setSubmitting] = useState(false)
    const [error, setError] = useState<string | null>(
        errorFromUrl === 'INVALID_TOKEN' ? 'That reset link is invalid or has expired. Request a new one below.' : null,
    )

    useEffect(() => {
        if (errorFromUrl === 'INVALID_TOKEN') setStage('request')
    }, [errorFromUrl])

    const pwScore = scorePassword(pw)
    const pwMatch = pw.length > 0 && pw === pw2
    const canSetNew = pwScore >= 2 && pwMatch && !!tokenFromUrl
    const stageIdx = STAGES.indexOf(stage)

    const onBackToSignIn = () => router.push('/login')

    function callbackUrl(): string {
        if (typeof window === 'undefined') return '/reset-password'
        return `${window.location.origin}/reset-password`
    }

    async function doRequestReset(addr: string) {
        const { error } = await requestPasswordReset({
            email: addr,
            redirectTo: callbackUrl(),
        })
        if (error) {
            setError(error.message ?? 'Could not send reset email.')
            return false
        }
        return true
    }

    const handleRequest = async (e: FormEvent) => {
        e.preventDefault()
        if (!email || submitting) return
        setError(null)
        setSubmitting(true)
        const ok = await doRequestReset(email)
        setSubmitting(false)
        if (ok) setStage('sent')
    }

    const handleResend = async () => {
        if (!email || resent) return
        const ok = await doRequestReset(email)
        if (ok) setResent(true)
    }

    const handleSetNew = async (e: FormEvent) => {
        e.preventDefault()
        if (!canSetNew || !tokenFromUrl || submitting) return
        setError(null)
        setSubmitting(true)
        const { error } = await resetPassword({ newPassword: pw, token: tokenFromUrl })
        setSubmitting(false)
        if (error) {
            setError(error.message ?? 'Could not reset password.')
            return
        }
        setStage('done')
    }

    return (
        <AuthShell>
            <main className="w-full max-w-230 mx-auto bg-surface-container-lowest rounded-2xl editorial-shadow flex overflow-hidden min-h-145 relative">
                <div className="absolute -top-[20%] -right-[10%] w-1/2 h-1/2 bg-[rgba(0,219,233,0.18)] rounded-full blur-[96px] pointer-events-none" />
                <section className="w-[42%] bg-surface-container-high p-12 flex flex-col justify-between">
                    <Wordmark size={32} />
                    <div className="flex flex-col gap-4">
                        <h1 className="font-serif font-normal italic text-[48px] leading-none tracking-[-0.01em] text-on-surface m-0">
                            {stage === 'done' ? (
                                <>
                                    You&apos;re
                                    <br />
                                    back in.
                                </>
                            ) : (
                                <>
                                    Reset your
                                    <br />
                                    password.
                                </>
                            )}
                        </h1>
                        <p className="font-body font-normal text-[14px] leading-normal text-on-surface-variant max-w-70 m-0">
                            {stage === 'request' && "We'll email you a link to set a new one. Takes a minute."}
                            {stage === 'sent' && 'Open the link from your inbox to continue.'}
                            {stage === 'set-new' && "Pick something memorable. We won't make you change it again."}
                            {stage === 'done' && 'Your new password is saved. Welcome back.'}
                        </p>
                    </div>
                </section>

                <section className="flex-1 p-14 flex flex-col relative z-2">
                    <div className="max-w-90 w-full mx-auto flex-1 flex flex-col gap-6">
                        <div className="flex items-center gap-2">
                            {STAGES.map((s, i) => (
                                <div
                                    key={s}
                                    className={[
                                        'h-1 flex-1 rounded-sm',
                                        i <= stageIdx ? 'bg-primary-container' : 'bg-surface-container',
                                    ].join(' ')}
                                />
                            ))}
                            <Eyebrow className="ml-2">
                                {stageIdx + 1} of {STAGES.length}
                            </Eyebrow>
                        </div>

                        {error && (
                            <div className="rounded-lg bg-error-container text-on-error-container px-3 py-2 font-body text-[13px]">
                                {error}
                            </div>
                        )}

                        {stage === 'request' && (
                            <form
                                onSubmit={(e) => {
                                    void handleRequest(e)
                                }}
                                className="flex flex-col gap-5 flex-1">
                                <div className="flex flex-col gap-2 flex-1 justify-center">
                                    <ModalTitle>Forgot your password?</ModalTitle>
                                    <SubHeadline>Enter the email on your account and we&apos;ll send a reset link.</SubHeadline>
                                    <div className="mt-3">
                                        <TextField label="Email" value={email} onChange={setEmail} placeholder="you@email.com" autoFocus />
                                    </div>
                                </div>
                                <div className="flex flex-col gap-3.5 pt-2">
                                    <PrimaryButton size="lg" type="submit" emphasis="pop" fullWidth disabled={!email || submitting}>
                                        {submitting ? 'Sending…' : 'Send reset link'}
                                    </PrimaryButton>
                                    <div className="flex justify-center">
                                        <TertiaryButton onClick={onBackToSignIn}>← Back to sign in</TertiaryButton>
                                    </div>
                                </div>
                            </form>
                        )}

                        {stage === 'sent' && (
                            <div className="flex flex-col gap-5 flex-1">
                                <div className="flex flex-col gap-4 flex-1 justify-center">
                                    <div className="w-14 h-14 rounded-full bg-primary-soft text-on-primary-soft inline-flex items-center justify-center">
                                        <Icon name="mail" size={28} />
                                    </div>
                                    <ModalTitle>Check your email.</ModalTitle>
                                    <SubHeadline>
                                        We sent a reset link to <strong className="text-on-surface">{email || 'your address'}</strong>. The
                                        link is good for the next 30 minutes.
                                    </SubHeadline>
                                    <span className="font-body font-normal text-[13px] leading-normal text-on-surface-variant">
                                        Don&apos;t see it? Check your spam folder, or{' '}
                                        <button
                                            type="button"
                                            onClick={() => {
                                                void handleResend()
                                            }}
                                            className="bg-transparent border-0 p-0 text-primary cursor-pointer font-inherit underline">
                                            {resent ? 'sent again ✓' : 'resend the link'}
                                        </button>
                                        .
                                    </span>
                                </div>
                                <div className="flex flex-col gap-3.5 pt-2">
                                    <div className="flex justify-center">
                                        <TertiaryButton onClick={() => setStage('request')}>← Use a different email</TertiaryButton>
                                    </div>
                                </div>
                            </div>
                        )}

                        {stage === 'set-new' && (
                            <form
                                onSubmit={(e) => {
                                    void handleSetNew(e)
                                }}
                                className="flex flex-col gap-5 flex-1">
                                <div className="flex flex-col gap-4 flex-1 justify-center">
                                    <ModalTitle>Set a new password.</ModalTitle>
                                    <SubHeadline>At least 8 characters, with a mix of letters and numbers.</SubHeadline>
                                    <TextField
                                        label="New password"
                                        value={pw}
                                        onChange={setPw}
                                        type={showPw ? 'text' : 'password'}
                                        placeholder="••••••••••••"
                                        autoFocus
                                        rightSlot={
                                            <button
                                                type="button"
                                                onClick={() => setShowPw(!showPw)}
                                                aria-label="Toggle password visibility"
                                                className="bg-transparent border-0 text-outline cursor-pointer p-1 inline-flex">
                                                <Icon name={showPw ? 'eye-off' : 'eye'} size={18} />
                                            </button>
                                        }
                                    />
                                    <div className="flex items-center gap-2 -mt-2">
                                        {[0, 1, 2, 3].map((i) => {
                                            const filled = i < pwScore
                                            const fillClass = !filled
                                                ? 'bg-surface-container'
                                                : pwScore <= 1
                                                  ? 'bg-error-container'
                                                  : pwScore === 2
                                                    ? 'bg-secondary-soft'
                                                    : 'bg-primary-container'
                                            return (
                                                <div
                                                    key={i}
                                                    className={`h-0.75 flex-1 rounded-[3px] transition-colors duration-200 ease-sheemu ${fillClass}`}
                                                />
                                            )
                                        })}
                                        <Eyebrow className="ml-1">{PW_LABELS[pwScore]}</Eyebrow>
                                    </div>
                                    <TextField
                                        label="Confirm password"
                                        value={pw2}
                                        onChange={setPw2}
                                        type={showPw ? 'text' : 'password'}
                                        placeholder="••••••••••••"
                                    />
                                    {pw2.length > 0 && !pwMatch && (
                                        <span className="font-body font-medium text-[12px] leading-[1.4] text-error">
                                            Passwords don&apos;t match yet.
                                        </span>
                                    )}
                                </div>
                                <div className="flex flex-col gap-3.5 pt-2">
                                    <PrimaryButton size="lg" type="submit" emphasis="pop" fullWidth disabled={!canSetNew || submitting}>
                                        {submitting ? 'Saving…' : 'Save new password'}
                                    </PrimaryButton>
                                    <div className="flex justify-center">
                                        <TertiaryButton onClick={onBackToSignIn}>← Cancel</TertiaryButton>
                                    </div>
                                </div>
                            </form>
                        )}

                        {stage === 'done' && (
                            <div className="flex flex-col gap-5 flex-1">
                                <div className="flex flex-col gap-4 flex-1 justify-center">
                                    <div className="w-14 h-14 rounded-full bg-primary-container text-on-primary-container inline-flex items-center justify-center">
                                        <Icon name="check" size={28} />
                                    </div>
                                    <ModalTitle>Password updated.</ModalTitle>
                                    <SubHeadline>You can sign in with your new password now.</SubHeadline>
                                </div>
                                <div className="pt-2">
                                    <Link href="/login" className="no-underline">
                                        <PrimaryButton size="lg" emphasis="pop" fullWidth icon="arrow-right" onClick={onBackToSignIn}>
                                            Sign in
                                        </PrimaryButton>
                                    </Link>
                                </div>
                            </div>
                        )}
                    </div>
                </section>
            </main>
        </AuthShell>
    )
}
