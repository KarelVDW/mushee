'use client'

import { useRouter } from 'next/navigation'
import { useEffect } from 'react'

import { ErrorScreen } from '@/components/ui'
import { captureException } from '@/lib/analytics'
import { NetworkError } from '@/lib/api'

/** Route-level boundary: catches errors thrown during render anywhere in the app. */
export default function ErrorBoundary({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
    const router = useRouter()

    useEffect(() => {
        console.error(error)
        captureException(error, { digest: error.digest, boundary: 'route' })
    }, [error])

    const serverDown = error instanceof NetworkError
    return (
        <ErrorScreen
            title={serverDown ? "Can't reach the server" : 'Something went wrong'}
            message={
                serverDown
                    ? 'Solkey could not connect to its server. Check your internet connection, or try again in a moment — we might be doing maintenance.'
                    : 'An unexpected error interrupted this page. Your scores are safe — try again, and if it keeps happening, reload the page.'
            }
            onRetry={reset}
            onBack={() => router.push('/')}
            backLabel="Go home"
        />
    )
}
