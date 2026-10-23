'use client'

import { SuccessMark } from '@mushee/ui'
import { useRouter, useSearchParams } from 'next/navigation'
import { type FormEvent, Suspense, useRef, useState } from 'react'

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
import { AuthPrefill, FieldErrorAnnouncement } from '@/components/ui/AuthCard'
import { NEW_PASSWORD_HINT, PASSWORD_MIN_LENGTH, scorePassword } from '@/components/ui/Password'
import { requestPasswordReset, resetPassword } from '@/lib/auth-client'
import { AuthErrorCopy, type AuthErrorField, type AuthErrorMessage } from '@/lib/AuthErrorCopy'
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

/** The phones' one-line brand strip (and h1) for each stage. */
const STAGE_MOBILE_TAGLINE: Record<Stage, string> = {
    request: 'Reset your password.',
    sent: 'Reset your password.',
    'set-new': 'Reset your password.',
    done: "You're back in.",
}

/** The request stage's own check: an address to send the link to. */
const EMAIL_NEEDED: AuthErrorMessage = { message: 'Enter the email on your account.', kind: 'form', field: 'email' }

/** The pair's mismatch, in the words NewPasswordFields shows under the confirmation. */
const MISMATCH = "Passwords don't match yet."

/**
 * Why a new password can't be saved yet, checked on submit (the button is never disabled for
 * it): the rule it fails, the confirmation that doesn't match, or null when it passes
 * isAcceptablePassword. `field` is the first failing field, which takes focus.
 */
function newPasswordProblem(pw: string, confirm: string): { message: string; field: 'new' | 'confirm' } | null {
    if (isAcceptablePassword(pw, confirm)) return null
    if (pw.length < PASSWORD_MIN_LENGTH) return { message: 'Use at least 8 characters.', field: 'new' }
    if (scorePassword(pw) < 2) return { message: NEW_PASSWORD_HINT, field: 'new' }
    return { message: MISMATCH, field: 'confirm' }
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
    // The set-new stage's own check, shown once Save is pressed (cleared by the next try).
    const [check, setCheck] = useState<ReturnType<typeof newPasswordProblem>>(null)
    const emailRef = useRef<HTMLInputElement>(null)
    const setNewFormRef = useRef<HTMLFormElement>(null)

    const onBackToSignIn = () => {
        AuthPrefill.offer({ email })
        router.push(signInPath)
    }

    async function doRequestReset(addr: string) {
        try {
            const { error } = await requestPasswordReset({
                email: addr,
                // The emailed link comes back here with ?token= added, so ?next= survives the trip through the inbox.
                redirectTo: `${window.location.origin}${withNext('/reset-password', next)}`,
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
        if (submitting) return
        if (!email.trim()) {
            setError(EMAIL_NEEDED)
            emailRef.current?.focus()
            return
        }
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
        if (!tokenFromUrl || submitting) return
        setError(null)
        const problem = newPasswordProblem(pw, pw2)
        setCheck(problem)
        if (problem) {
            // The first failing field takes focus: New password, or its confirmation.
            setNewFormRef.current?.querySelectorAll<HTMLInputElement>('input')[problem.field === 'new' ? 0 : 1]?.focus()
            return
        }
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

    // A problem with one of the stage's fields sits under that field (and is read out); any other
    // is the stage's banner, under its title and fields, just above its button — in reading order.
    const fieldOfStage: AuthErrorField | null = stage === 'request' ? 'email' : stage === 'set-new' ? 'password' : null
    const fieldError = error && error.field === fieldOfStage ? error.message : undefined
    const errorAlert = error && !fieldError && <Alert tone={error.kind}>{error.message}</Alert>
    // The set-new check, unless NewPasswordFields already shows the mismatch under the confirmation.
    const checkLine = stage === 'set-new' && check && !(check.message === MISMATCH && pw2 !== '') ? check.message : undefined
    const announced = fieldError ?? (stage === 'set-new' ? check?.message : undefined)
    const announcedLabel = fieldOfStage === 'email' ? 'Email' : check?.field === 'confirm' ? 'Confirm password' : 'New password'

    return (
        <AuthShell>
            <AuthFrame
                headline={stage === 'done' ? ["You're", 'back in.'] : ['Reset your', 'password.']}
                tagline={STAGE_TAGLINE[stage]}
                mobileTagline={STAGE_MOBILE_TAGLINE[stage]}>
                <FieldErrorAnnouncement label={announcedLabel} message={announced} />
                <div className="flex-1 flex flex-col gap-6">
                    {stage === 'request' && (
                        <form
                            method="post"
                            onSubmit={(e) => {
                                void handleRequest(e)
                            }}
                            className="flex flex-col gap-5">
                            <div className="flex flex-col gap-2">
                                <ModalTitle size="lead">Forgot your password?</ModalTitle>
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
                                        inputRef={emailRef}
                                        error={fieldError}
                                    />
                                </div>
                                {errorAlert && <div className="mt-3">{errorAlert}</div>}
                            </div>
                            <div className="flex flex-col gap-3.5 pt-2">
                                <PrimaryButton size="lg" type="submit" emphasis="pop" fullWidth disabled={submitting}>
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
                        <div className="flex flex-col gap-5">
                            <div className="flex flex-col gap-4">
                                <div className="w-14 h-14 rounded-full bg-primary-soft text-on-primary-soft inline-flex items-center justify-center">
                                    <Icon name="mail" size={28} />
                                </div>
                                <ModalTitle size="lead">Check your email.</ModalTitle>
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
                                        className={[
                                            'relative bg-transparent border-0 p-0 text-primary cursor-pointer font-body text-[13px] underline rounded-sm focus-ring',
                                            // A 40px+ tap area on touch, without spreading the sentence apart.
                                            "pointer-coarse:after:absolute pointer-coarse:after:-inset-x-1 pointer-coarse:after:-inset-y-3 pointer-coarse:after:content-['']",
                                        ].join(' ')}>
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
                            method="post"
                            ref={setNewFormRef}
                            onSubmit={(e) => {
                                void handleSetNew(e)
                            }}
                            className="flex flex-col gap-5">
                            <div className="flex flex-col gap-4">
                                <ModalTitle size="lead">Set a new password.</ModalTitle>
                                {/* The rule itself is the field's hint, worded to match what the form accepts. */}
                                <SubHeadline>You&apos;ll use it the next time you sign in.</SubHeadline>
                                <NewPasswordFields
                                    value={pw}
                                    onChange={(v) => {
                                        setPw(v)
                                        setCheck(null)
                                    }}
                                    confirm={pw2}
                                    onConfirmChange={(v) => {
                                        setPw2(v)
                                        setCheck(null)
                                    }}
                                    confirmLabel="Confirm password"
                                    autoFocus
                                    // The pair's one error slot, under both fields.
                                    confirmError={fieldError ?? checkLine}
                                />
                                {errorAlert}
                            </div>
                            <div className="flex flex-col gap-3.5 pt-2">
                                <PrimaryButton size="lg" type="submit" emphasis="pop" fullWidth disabled={submitting}>
                                    {submitting ? 'Saving…' : 'Save new password'}
                                </PrimaryButton>
                                <div className="flex justify-center">
                                    <TertiaryButton onClick={onBackToSignIn}>Cancel</TertiaryButton>
                                </div>
                            </div>
                        </form>
                    )}

                    {stage === 'done' && (
                        <div className="flex flex-col gap-5">
                            <div className="flex flex-col gap-4">
                                <SuccessMark size={56} />
                                <ModalTitle size="lead">Password updated.</ModalTitle>
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
