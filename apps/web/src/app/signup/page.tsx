'use client'

import { useRouter } from 'next/navigation'
import { type FormEvent, useState } from 'react'

import { AuthCard, AuthShell } from '@/components/ui'
import { track } from '@/lib/analytics'
import { emailOtp, signUp } from '@/lib/auth-client'
import { BETA_MODE } from '@/lib/plans'

export default function SignupPage() {
    const router = useRouter()
    const [name, setName] = useState('')
    const [email, setEmail] = useState('')
    const [password, setPassword] = useState('')
    const [showPassword, setShowPassword] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [loading, setLoading] = useState(false)

    function handleSubmit(e: FormEvent) {
        e.preventDefault()
        setError(null)
        setLoading(true)

        void signUp.email({ name, email, password }).then(({ error }) => {
            if (error) {
                setError(error.message ?? 'Signup failed')
                setLoading(false)
            } else {
                track('signup_completed', { beta: BETA_MODE })
                void emailOtp.sendVerificationOtp({ email, type: 'email-verification' }).then(({ error }) => {
                    if (!error) router.push('/onboarding')
                })
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
                            <strong>Sheemu is in closed beta.</strong> Signing up puts you on the waitlist — we approve new accounts
                            personally, usually within a day. Beta accounts record free for 5 minutes a day.
                        </>
                    ) : undefined
                }
                name={name}
                email={email}
                password={password}
                showPassword={showPassword}
                error={error}
                loading={loading}
                onNameChange={setName}
                onEmailChange={setEmail}
                onPasswordChange={setPassword}
                onToggleShowPassword={() => setShowPassword((v) => !v)}
                onSubmit={handleSubmit}
            />
        </AuthShell>
    )
}
