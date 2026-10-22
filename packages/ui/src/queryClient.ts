import { MutationCache, QueryClient } from '@tanstack/react-query'

import { ApiError, NetworkError } from './http'
import { showToast } from './Toast'

// The meta every mutation may carry, read by the MutationCache's onError below —
// typed so a misspelt key fails compilation instead of the toast.
declare module '@tanstack/react-query' {
    interface Register {
        mutationMeta: {
            /** The failure toast's message, in place of the generic network/API phrasing. */
            errorMessage?: string
            /** The caller renders the failure itself, so no toast. */
            silentError?: boolean
        }
    }
}

function toastMessage(error: unknown, fallback: string): string {
    if (error instanceof NetworkError) return "Can't reach the server — check your connection."
    if (error instanceof ApiError) return error.message
    return fallback
}

/**
 * The query cache setup the apps share: queries stay fresh for 30s and retry
 * only transient failures, and a failed mutation raises a toast. Build one per
 * browser session (`useState(createQueryClient)`).
 */
export function createQueryClient(): QueryClient {
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
                showToast(mutation.meta?.errorMessage ?? toastMessage(error, 'Something went wrong. Please try again.'))
            },
        }),
    })
}
