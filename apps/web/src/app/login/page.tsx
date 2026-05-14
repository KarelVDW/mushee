'use client'

import { useRouter } from 'next/navigation'
import { type FormEvent, useState } from 'react'

import { AuthCard, AuthShell } from '@/components/ui'
import { signIn } from '@/lib/auth-client'

export default function LoginPage() {
    const router = useRouter()
    const [email, setEmail] = useState('')
    const [password, setPassword] = useState('')
    const [showPassword, setShowPassword] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [loading, setLoading] = useState(false)

    function handleSubmit(e: FormEvent) {
        e.preventDefault()
        setError(null)
        setLoading(true)

        void signIn.email({ email, password }).then(({ data, error }) => {
            if (error) {
                setError(error.message ?? 'Login failed')
                setLoading(false)
                return
            }
            router.push(data?.user?.emailVerified ? '/scores' : '/onboarding')
        })
    }

    return (
        <AuthShell>
            <AuthCard
                mode="signin"
                email={email}
                password={password}
                showPassword={showPassword}
                error={error}
                loading={loading}
                onEmailChange={setEmail}
                onPasswordChange={setPassword}
                onToggleShowPassword={() => setShowPassword((v) => !v)}
                onSubmit={handleSubmit}
            />
        </AuthShell>
    )
}
