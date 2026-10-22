'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import { type FormEvent, Suspense, useState } from 'react'

import {
    Alert,
    AuthFrame,
    AuthShell,
    Icon,
    isAcceptablePassword,
    ModalTitle,
    NewPasswordFields,
    PrimaryButton,
    StepProgress,
    SubHeadline,
    TertiaryButton,
    TextField,
} from '@/components/ui'
import { requestPasswordReset, resetPassword } from '@/lib/auth-client'

const STAGES = ['request', 'sent', 'set-new', 'done'] as const
type Stage = (typeof STAGES)[number]

const STAGE_TAGLINE: Record<Stage, string> = {
    request: "We'll email you a link to set a new one. Takes a minute.",
    sent: 'Open the link from your inbox to continue.',
    'set-new': "Pick something memorable. We won't make you change it again.",
    done: 'Your new password is saved. Welcome back.',
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

    // better-auth lands here with ?token= to set a new password, or with ?error=INVALID_TOKEN
    // for a dead link, which starts over at the request form.
    const [stage, setStage] = useState<Stage>(tokenFromUrl && errorFromUrl !== 'INVALID_TOKEN' ? 'set-new' : 'request')
    const [email, setEmail] = useState('')
    const [pw, setPw] = useState('')
    const [pw2, setPw2] = useState('')
    const [resent, setResent] = useState(false)
    const [submitting, setSubmitting] = useState(false)
    const [error, setError] = useState<string | null>(
        errorFromUrl === 'INVALID_TOKEN' ? 'That reset link is invalid or has expired. Request a new one below.' : null,
    )

    const canSetNew = isAcceptablePassword(pw, pw2) && !!tokenFromUrl
    const stageIdx = STAGES.indexOf(stage)

    const onBackToSignIn = () => router.push('/login')

    async function doRequestReset(addr: string) {
        const { error } = await requestPasswordReset({
            email: addr,
            redirectTo: `${window.location.origin}/reset-password`,
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
            <AuthFrame headline={stage === 'done' ? ["You're", 'back in.'] : ['Reset your', 'password.']} tagline={STAGE_TAGLINE[stage]}>
                <div className="flex-1 flex flex-col gap-6">
                    <StepProgress step={stageIdx} total={STAGES.length} fill />

                    {error && <Alert>{error}</Alert>}

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
                                    <TertiaryButton onClick={onBackToSignIn}>
                                        <span className="inline-flex items-center gap-1.5">
                                            <Icon name="arrow-left" size={13} />
                                            Back to sign in
                                        </span>
                                    </TertiaryButton>
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
                                    We sent a reset link to <strong className="text-on-surface">{email || 'your address'}</strong>. The link
                                    is good for the next 30 minutes.
                                </SubHeadline>
                                <span className="font-body font-normal text-[13px] leading-normal text-on-surface-variant">
                                    Don&apos;t see it? Check your spam folder, or{' '}
                                    <button
                                        type="button"
                                        onClick={() => {
                                            void handleResend()
                                        }}
                                        className="bg-transparent border-0 p-0 text-primary cursor-pointer font-body text-[13px] underline">
                                        {resent ? 'link sent again' : 'resend the link'}
                                    </button>
                                    .
                                </span>
                            </div>
                            <div className="flex flex-col gap-3.5 pt-2">
                                <div className="flex justify-center">
                                    <TertiaryButton onClick={() => setStage('request')}>
                                        <span className="inline-flex items-center gap-1.5">
                                            <Icon name="arrow-left" size={13} />
                                            Use a different email
                                        </span>
                                    </TertiaryButton>
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
                                <NewPasswordFields
                                    value={pw}
                                    onChange={setPw}
                                    confirm={pw2}
                                    onConfirmChange={setPw2}
                                    confirmLabel="Confirm password"
                                    autoFocus
                                />
                            </div>
                            <div className="flex flex-col gap-3.5 pt-2">
                                <PrimaryButton size="lg" type="submit" emphasis="pop" fullWidth disabled={!canSetNew || submitting}>
                                    {submitting ? 'Saving…' : 'Save new password'}
                                </PrimaryButton>
                                <div className="flex justify-center">
                                    <TertiaryButton onClick={onBackToSignIn}>Cancel</TertiaryButton>
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
                                <PrimaryButton size="lg" emphasis="pop" fullWidth icon="arrow-right" href="/login">
                                    Sign in
                                </PrimaryButton>
                            </div>
                        </div>
                    )}
                </div>
            </AuthFrame>
        </AuthShell>
    )
}
