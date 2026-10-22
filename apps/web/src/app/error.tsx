'use client'

import { useRouter } from 'next/navigation'
import { useEffect } from 'react'

import { ErrorScreen } from '@/components/ui'
import { captureException } from '@/lib/analytics'
import { NetworkError } from '@/lib/api'

/**
 * Route-level boundary: catches errors thrown during render anywhere in the app. A page that
 * couldn't reach the API gets the neutral "can't connect" screen — the offline copy when the
 * device has no network, and a retry the moment it comes back (ErrorScreen's `unreachable`
 * tone); it doesn't poll, so its copy promises no automatic retries. Real faults keep the
 * red well.
 */
export default function ErrorBoundary({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
    const router = useRouter()

    useEffect(() => {
        console.error(error)
        captureException(error, { digest: error.digest, boundary: 'route' })
    }, [error])

    const unreachable = error instanceof NetworkError
    return (
        <ErrorScreen
            tone={unreachable ? 'unreachable' : 'fault'}
            title={unreachable ? "Solkey isn't answering" : 'Something went wrong'}
            message={
                unreachable
                    ? "We can't reach Solkey right now. Try again in a moment — your scores are safe."
                    : 'An unexpected error interrupted this page. Your scores are safe — try again, and if it keeps happening, reload the page.'
            }
            onRetry={reset}
            onBack={() => router.push('/')}
            backLabel="Go home"
        />
    )
}
