'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import { type FormEvent, Suspense, useState } from 'react'

import { Alert, Eyebrow, PrimaryButton, TextField, Wordmark } from '@/components/ui'
import { ApiError, login, NetworkError } from '@/lib/api'

function LoginForm() {
    const router = useRouter()
    const searchParams = useSearchParams()
    const [secret, setSecret] = useState('')
    const [error, setError] = useState<string | null>(null)
    const [busy, setBusy] = useState(false)

    const submit = async (event: FormEvent) => {
        event.preventDefault()
        if (!secret || busy) return
        setBusy(true)
        setError(null)
        try {
            await login(secret)
            const next = searchParams.get('next')
            // Only follow same-app relative paths — never an absolute URL.
            router.push(next && next.startsWith('/') && !next.startsWith('//') ? next : '/')
        } catch (err) {
            if (err instanceof ApiError) setError(err.message)
            else if (err instanceof NetworkError) setError("Can't reach the server — check your connection.")
            else setError('Something went wrong. Please try again.')
            setBusy(false)
        }
    }

    return (
        <main className="min-h-dvh flex items-center justify-center px-5">
            <div className="w-full max-w-sm bg-surface-container-lowest rounded-xl tonal-layer-glow p-8 sm:p-10">
                <div className="flex items-baseline gap-2 mb-2">
                    <Wordmark size={26} />
                    <Eyebrow className="text-secondary">Admin</Eyebrow>
                </div>
                <p className="font-body text-[14px] leading-normal text-on-surface-variant m-0 mb-7">
                    Enter the console secret to continue.
                </p>
                <form onSubmit={(e) => void submit(e)} className="flex flex-col gap-5">
                    <TextField
                        label="Console secret"
                        type="password"
                        value={secret}
                        onChange={setSecret}
                        leftIcon="lock"
                        placeholder="••••••••••••"
                        autoFocus
                    />
                    {error && <Alert>{error}</Alert>}
                    <PrimaryButton type="submit" disabled={!secret || busy} fullWidth>
                        {busy ? 'Checking…' : 'Enter console'}
                    </PrimaryButton>
                </form>
            </div>
        </main>
    )
}

export default function LoginPage() {
    // useSearchParams needs a Suspense boundary during prerender.
    return (
        <Suspense fallback={null}>
            <LoginForm />
        </Suspense>
    )
}
