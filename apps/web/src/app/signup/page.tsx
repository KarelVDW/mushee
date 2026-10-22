'use client'

import { useRouter } from 'next/navigation'
import { type FormEvent, useState } from 'react'

import { Turnstile, TURNSTILE_SITE_KEY } from '@/components/Turnstile'
import { AuthCard, AuthShell } from '@/components/ui'
import { track } from '@/lib/analytics'
import { emailOtp, signUp } from '@/lib/auth-client'
import { nextPathFrom, withNext } from '@/lib/nextPath'
import { BETA_MODE, requestedPlanFrom, withPlan } from '@/lib/plans'

export default function SignupPage() {
    const router = useRouter()
    const [name, setName] = useState('')
    const [email, setEmail] = useState('')
    const [password, setPassword] = useState('')
    const [error, setError] = useState<string | null>(null)
    const [loading, setLoading] = useState(false)
    // Signup CAPTCHA (when a site key is configured): the token is single-use, so a
    // rejected attempt remounts the widget for a fresh challenge.
    const [captchaToken, setCaptchaToken] = useState<string | null>(null)
    const [captchaAttempt, setCaptchaAttempt] = useState(0)

    function handleSubmit(e: FormEvent) {
        e.preventDefault()
        setError(null)
        setLoading(true)

        void signUp
            .email({
                name,
                email,
                password,
                fetchOptions: { headers: captchaToken ? { 'x-captcha-response': captchaToken } : {} },
            })
            .then(({ error }) => {
                if (error) {
                    setError(error.message ?? 'Signup failed')
                    setLoading(false)
                    if (TURNSTILE_SITE_KEY) {
                        setCaptchaToken(null)
                        setCaptchaAttempt((n) => n + 1)
                    }
                } else {
                    track('signup_completed', { beta: BETA_MODE })
                    // The account exists at this point — never strand the user on a
                    // frozen form. Onboarding's verify-email step can re-send the
                    // code, so a failed initial send proceeds all the same.
                    // A visitor who came from somewhere specific (a shared score) gets back there after onboarding,
                    // and one who picked a pricing card finds that tier preselected in its plan step.
                    const search = window.location.search
                    const goToOnboarding = () =>
                        router.push(withPlan(withNext('/onboarding', nextPathFrom(search)), requestedPlanFrom(search)))
                    void emailOtp.sendVerificationOtp({ email, type: 'email-verification' }).then(goToOnboarding, goToOnboarding)
                }
            })
    }

    return (
        <AuthShell>
            <AuthCard
                mode="signup"
                notice={
                    BETA_MODE ? (
                        <>
                            <strong>Solkey is in closed beta.</strong> Signing up puts you on the waitlist — we approve new accounts
                            personally, usually within a day.
                        </>
                    ) : undefined
                }
                name={name}
                email={email}
                password={password}
                error={error}
                loading={loading}
                submitDisabled={!!TURNSTILE_SITE_KEY && !captchaToken}
                beforeSubmit={
                    TURNSTILE_SITE_KEY && <Turnstile key={captchaAttempt} siteKey={TURNSTILE_SITE_KEY} onToken={setCaptchaToken} />
                }
                onNameChange={setName}
                onEmailChange={setEmail}
                onPasswordChange={setPassword}
                onSubmit={handleSubmit}
            />
        </AuthShell>
    )
}
