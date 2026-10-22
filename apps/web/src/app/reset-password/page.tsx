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
    SubHeadline,
    TertiaryButton,
    TextField,
} from '@/components/ui'
import { AuthPrefill } from '@/components/ui/AuthCard'
import { requestPasswordReset, resetPassword } from '@/lib/auth-client'
import { AuthErrorCopy, type AuthErrorMessage } from '@/lib/AuthErrorCopy'
import { nextPathFrom, withNext } from '@/lib/nextPath'

type Stage = 'request' | 'sent' | 'set-new' | 'done'

const STAGE_TAGLINE: Record<Stage, string> = {
    request: "We'll email you a link to set a new one. Takes a minute.",
    sent: 'Open the link from your inbox to continue.',
    'set-new': "Pick something memorable. We won't make you change it again.",
    done: 'Your new password is saved. Welcome back.',
}

/** better-auth's code for a reset link that has expired or was already used. */
const INVALID_TOKEN = 'INVALID_TOKEN'

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
    // A deep link that bounced through sign-in keeps its destination through the reset too.
    const next = nextPathFrom(`?${searchParams.toString()}`)
    const signInPath = withNext('/login', next)

    // better-auth lands here with ?token= to set a new password, or with ?error=INVALID_TOKEN
    // for a dead link, which starts over at the request form.
    const [stage, setStage] = useState<Stage>(tokenFromUrl && errorFromUrl !== INVALID_TOKEN ? 'set-new' : 'request')
    // The sign-in form hands over the address it was given ("reset your password", "Forgot password?").
    const [email, setEmail] = useState(() => AuthPrefill.read().email ?? '')
    const [pw, setPw] = useState('')
    const [pw2, setPw2] = useState('')
    const [resent, setResent] = useState(false)
    const [submitting, setSubmitting] = useState(false)
    // A dead link sends the user back to ask for a fresh one, under its own button label.
    const [linkExpired, setLinkExpired] = useState(errorFromUrl === INVALID_TOKEN)
    const [error, setError] = useState<AuthErrorMessage | null>(errorFromUrl === INVALID_TOKEN ? AuthErrorCopy.for(INVALID_TOKEN) : null)

    const canSetNew = isAcceptablePassword(pw, pw2) && !!tokenFromUrl

    const onBackToSignIn = () => {
        AuthPrefill.offer({ email })
        router.push(signInPath)
    }

    async function doRequestReset(addr: string) {
        try {
            const { error } = await requestPasswordReset({
                email: addr,
                redirectTo: `${window.location.origin}/reset-password`,
            })
            if (error) {
                setError(AuthErrorCopy.for(error))
                return false
            }
            return true
        } catch (err) {
            setError(AuthErrorCopy.for(err))
            return false
        }
    }

    const handleRequest = async (e: FormEvent) => {
        e.preventDefault()
        if (!email || submitting) return
        setError(null)
        setSubmitting(true)
        const ok = await doRequestReset(email)
        setSubmitting(false)
        if (ok) {
            setLinkExpired(false)
            setStage('sent')
        }
    }

    const handleResend = async () => {
        if (!email || resent) return
        setError(null)
        const ok = await doRequestReset(email)
        if (ok) setResent(true)
    }

    const handleSetNew = async (e: FormEvent) => {
        e.preventDefault()
        if (!canSetNew || !tokenFromUrl || submitting) return
        setError(null)
        setSubmitting(true)
        let failure: unknown = null
        try {
            const { error } = await resetPassword({ newPassword: pw, token: tokenFromUrl })
            failure = error
        } catch (err) {
            failure = err
        }
        setSubmitting(false)
        if (!failure) {
            setStage('done')
            return
        }
        const copy = AuthErrorCopy.for(failure)
        setError(copy)
        // The link died while the form was open: ask for a new one right here.
        if (copy.action === 'request-new-link') {
            setLinkExpired(true)
            setStage('request')
        }
    }

    // Under the stage's title and the fields, just above its button — in reading order.
    const errorAlert = error && <Alert>{error.message}</Alert>

    return (
        <AuthShell>
            <AuthFrame headline={stage === 'done' ? ["You're", 'back in.'] : ['Reset your', 'password.']} tagline={STAGE_TAGLINE[stage]}>
                <div className="flex-1 flex flex-col gap-6">
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
                                    <TextField
                                        label="Email"
                                        value={email}
                                        onChange={setEmail}
                                        placeholder="you@email.com"
                                        type="email"
                                        autoComplete="email"
                                        autoCapitalize="none"
                                        name="email"
                                        autoFocus
                                    />
                                </div>
                                {errorAlert && <div className="mt-3">{errorAlert}</div>}
                            </div>
                            <div className="flex flex-col gap-3.5 pt-2">
                                <PrimaryButton size="lg" type="submit" emphasis="pop" fullWidth disabled={!email || submitting}>
                                    {submitting ? 'Sending…' : linkExpired ? 'Send a new link' : 'Send reset link'}
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
                                        className="bg-transparent border-0 p-0 text-primary cursor-pointer font-body text-[13px] underline rounded-sm focus-ring">
                                        {resent ? 'link sent again' : 'resend the link'}
                                    </button>
                                    .
                                </span>
                                {errorAlert}
                            </div>
                            <div className="flex flex-col gap-3.5 pt-2">
                                <div className="flex justify-center">
                                    <TertiaryButton
                                        onClick={() => {
                                            setError(null)
                                            setStage('request')
                                        }}>
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
                                {/* The rule itself is the field's hint, worded to match what the form accepts. */}
                                <SubHeadline>You&apos;ll use it the next time you sign in.</SubHeadline>
                                <NewPasswordFields
                                    value={pw}
                                    onChange={setPw}
                                    confirm={pw2}
                                    onConfirmChange={setPw2}
                                    confirmLabel="Confirm password"
                                    autoFocus
                                />
                                {errorAlert}
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
                                <PrimaryButton size="lg" emphasis="pop" fullWidth icon="arrow-right" href={signInPath}>
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
