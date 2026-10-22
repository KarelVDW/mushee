'use client'

import { MutationCache, QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query'
import { type ReactNode, useEffect, useRef, useState } from 'react'

import { AnalyticsIdentitySync } from '@/components/AnalyticsIdentitySync'
import { BrowserSupportBanner } from '@/components/BrowserSupportBanner'
import { CookieConsent } from '@/components/CookieConsent'
import { showToast, Toaster } from '@/components/ui'
import { ApiError, NetworkError } from '@/lib/api'
import { useSession } from '@/lib/auth-client'

function toastMessage(error: unknown, fallback: string): string {
    if (error instanceof NetworkError) return "Can't reach the server — check your connection."
    if (error instanceof ApiError) return error.message
    return fallback
}

function makeQueryClient() {
    return new QueryClient({
        defaultOptions: {
            queries: {
                staleTime: 30_000,
                retry: (failureCount, error) => {
                    // 4xx answers are final; retry only transient failures (network, 5xx).
                    if (error instanceof ApiError && error.isClientError) return false
                    return failureCount < 2
                },
            },
        },
        mutationCache: new MutationCache({
            onError: (error, _variables, _context, mutation) => {
                // Mutations whose UI renders the error inline opt out of the toast.
                if (mutation.meta?.silentError) return
                // A mutation's own message ("Could not delete the score…") reads better
                // than the generic network/API phrasing, so it wins when provided.
                const metaMessage = mutation.meta?.errorMessage
                showToast(typeof metaMessage === 'string' ? metaMessage : toastMessage(error, 'Something went wrong. Please try again.'))
            },
        }),
    })
}

/**
 * The query cache belongs to one signed-in user. Query keys carry no user id, so
 * when that user signs out — or another account takes the session in this tab —
 * everything cached for them goes, before the next user's pages can render it as
 * fresh. The only place the cache is cleared. Renders nothing.
 */
export function SessionCacheScope() {
    const queryClient = useQueryClient()
    const { data: session, isPending } = useSession()
    const userId = session?.user?.id ?? null
    const lastUserId = useRef<string | null>(null)

    useEffect(() => {
        if (isPending) return
        if (lastUserId.current !== null && lastUserId.current !== userId) queryClient.clear()
        lastUserId.current = userId
    }, [userId, isPending, queryClient])

    return null
}

export function Providers({ children }: { children: ReactNode }) {
    // useState ensures one client per browser session, stable across re-renders.
    const [queryClient] = useState(makeQueryClient)

    return (
        <QueryClientProvider client={queryClient}>
            <SessionCacheScope />
            {children}
            <Toaster />
            <AnalyticsIdentitySync />
            <CookieConsent />
            <BrowserSupportBanner />
        </QueryClientProvider>
    )
}
