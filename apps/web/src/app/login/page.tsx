'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import { Suspense, useState } from 'react'

import { AuthCard, type AuthCredentials, AuthShell } from '@/components/ui'
import { signIn } from '@/lib/auth-client'
import { AuthErrorCopy, type AuthErrorMessage } from '@/lib/AuthErrorCopy'
import { formatPurgeDate } from '@/lib/dates'
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

/** What the sign-in card says after the user let a pending deletion stand and was signed out. */
function deletionStandsNotice(purgeAfter: string | undefined): string {
    const date = formatPurgeDate(purgeAfter)
    const when = date ? `on ${date}` : 'at the end of the 7-day grace period'
    return `Signed out. Your account will be deleted ${when}. Sign in before then if you change your mind.`
}

function LoginForm({ next }: { next?: string }) {
    const router = useRouter()
    const [error, setError] = useState<AuthErrorMessage | null>(null)
    const [loading, setLoading] = useState(false)
    const [pendingDeletion, setPendingDeletion] = useState<PendingDeletion | null>(null)
    // Set once the user chose to keep the deletion: the card then confirms it and its date.
    const [declinedNotice, setDeclinedNotice] = useState<string | null>(null)
    const checkPendingDeletion = useCheckPendingDeletion()

    function continueToApp(emailVerified: boolean) {
        // The auth middleware puts the originally requested path in ?next= so
        // deep links survive the login bounce — through onboarding too, for an
        // account that still has to verify its email. Same-origin paths only —
        // a full URL here would be an open redirect.
        const destination = nextPathFrom(window.location.search)
        router.push(emailVerified ? destination : withNext('/onboarding', destination))
    }

    async function submit({ email, password }: AuthCredentials) {
        setError(null)
        setDeclinedNotice(null)
        setLoading(true)
        try {
            const { data, error } = await signIn.email({ email, password })
            if (error) {
                setError(AuthErrorCopy.for(error))
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
        } catch (err) {
            // The request never reached the server (offline): say so, and free the form.
            setError(AuthErrorCopy.for(err))
            setLoading(false)
        }
    }

    return (
        <AuthShell>
            <AuthCard
                mode="signin"
                notice={declinedNotice}
                error={error}
                loading={loading}
                next={next}
                onSubmit={(credentials) => void submit(credentials)}
            />
            {pendingDeletion && (
                <ReactivateAccountDialog
                    purgeAfter={pendingDeletion.purgeAfter}
                    onReactivated={() => continueToApp(pendingDeletion.emailVerified)}
                    onDecline={() => {
                        setDeclinedNotice(deletionStandsNotice(pendingDeletion.purgeAfter))
                        setPendingDeletion(null)
                    }}
                />
            )}
        </AuthShell>
    )
}
