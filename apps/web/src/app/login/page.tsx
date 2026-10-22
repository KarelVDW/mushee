'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import { Suspense, useState } from 'react'

import { AuthCard, type AuthCredentials, AuthShell } from '@/components/ui'
import { signIn } from '@/lib/auth-client'
import { nextPathFrom, withNext } from '@/lib/nextPath'
import { useCheckPendingDeletion } from '@/lib/queries'

import { ReactivateAccountDialog } from './ReactivateAccountDialog'

interface PendingDeletion {
    purgeAfter?: string
    emailVerified: boolean
}

export default function LoginPage() {
    // useSearchParams needs a Suspense boundary on this prerendered page. The fallback is
    // the same form without ?next=, so the prerendered HTML still shows the card.
    return (
        <Suspense fallback={<LoginForm />}>
            <LoginWithNext />
        </Suspense>
    )
}

function LoginWithNext() {
    const params = useSearchParams()
    return <LoginForm next={nextPathFrom(`?${params.toString()}`)} />
}

function LoginForm({ next }: { next?: string }) {
    const router = useRouter()
    const [error, setError] = useState<string | null>(null)
    const [loading, setLoading] = useState(false)
    const [pendingDeletion, setPendingDeletion] = useState<PendingDeletion | null>(null)
    const checkPendingDeletion = useCheckPendingDeletion()

    function continueToApp(emailVerified: boolean) {
        // The auth middleware puts the originally requested path in ?next= so
        // deep links survive the login bounce — through onboarding too, for an
        // account that still has to verify its email. Same-origin paths only —
        // a full URL here would be an open redirect.
        const destination = nextPathFrom(window.location.search)
        router.push(emailVerified ? destination : withNext('/onboarding', destination))
    }

    function handleSubmit({ email, password }: AuthCredentials) {
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
            <AuthCard mode="signin" error={error} loading={loading} next={next} onSubmit={handleSubmit} />
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
