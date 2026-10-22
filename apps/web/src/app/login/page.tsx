'use client'

import { useRouter } from 'next/navigation'
import { type FormEvent, useState } from 'react'

import { AuthCard, AuthShell } from '@/components/ui'
import { signIn } from '@/lib/auth-client'
import { nextPathFrom } from '@/lib/nextPath'
import { useCheckPendingDeletion } from '@/lib/queries'

import { ReactivateAccountDialog } from './ReactivateAccountDialog'

interface PendingDeletion {
    purgeAfter?: string
    emailVerified: boolean
}

export default function LoginPage() {
    const router = useRouter()
    const [email, setEmail] = useState('')
    const [password, setPassword] = useState('')
    const [error, setError] = useState<string | null>(null)
    const [loading, setLoading] = useState(false)
    const [pendingDeletion, setPendingDeletion] = useState<PendingDeletion | null>(null)
    const checkPendingDeletion = useCheckPendingDeletion()

    function continueToApp(emailVerified: boolean) {
        if (!emailVerified) {
            router.push('/onboarding')
            return
        }
        // The auth middleware puts the originally requested path in ?next= so
        // deep links survive the login bounce. Same-origin paths only — a full
        // URL here would be an open redirect.
        router.push(nextPathFrom(window.location.search))
    }

    function handleSubmit(e: FormEvent) {
        e.preventDefault()
        setError(null)
        setLoading(true)

        void signIn.email({ email, password }).then(async ({ data, error }) => {
            if (error) {
                setError(error.message ?? 'Login failed')
                setLoading(false)
                return
            }
            const emailVerified = data?.user?.emailVerified ?? false

            // A soft-deleted account signs in normally during the grace period;
            // intercept here so the user can reactivate or stay on track.
            const deletion = await checkPendingDeletion().catch(() => null)
            if (deletion?.pending) {
                setPendingDeletion({ purgeAfter: deletion.purgeAfter, emailVerified })
                setLoading(false)
                return
            }
            continueToApp(emailVerified)
        })
    }

    return (
        <AuthShell>
            <AuthCard
                mode="signin"
                email={email}
                password={password}
                error={error}
                loading={loading}
                onEmailChange={setEmail}
                onPasswordChange={setPassword}
                onSubmit={handleSubmit}
            />
            {pendingDeletion && (
                <ReactivateAccountDialog
                    purgeAfter={pendingDeletion.purgeAfter}
                    onReactivated={() => continueToApp(pendingDeletion.emailVerified)}
                    onDecline={() => setPendingDeletion(null)}
                />
            )}
        </AuthShell>
    )
}
