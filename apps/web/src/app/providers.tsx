'use client'

import { MutationCache, QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { type ReactNode, useState } from 'react'

import { showToast, Toaster } from '@/components/ui'
import { ApiError, NetworkError } from '@/lib/api'

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

export function Providers({ children }: { children: ReactNode }) {
    // useState ensures one client per browser session, stable across re-renders.
    const [queryClient] = useState(makeQueryClient)

    return (
        <QueryClientProvider client={queryClient}>
            {children}
            <Toaster />
        </QueryClientProvider>
    )
}
