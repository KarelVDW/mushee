'use client'

import { useRouter } from 'next/navigation'
import { type FormEvent, useState } from 'react'

import { AuthCard, AuthShell } from '@/components/ui'
import { signUp } from '@/lib/auth-client'

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
                router.push('/onboarding')
            }
        })
    }

    return (
        <AuthShell>
            <AuthCard
                mode="signup"
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
