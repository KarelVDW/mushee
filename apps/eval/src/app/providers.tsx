'use client'

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useState } from 'react'

export function Providers({ children }: { children: React.ReactNode }) {
    const [queryClient] = useState(
        () =>
            new QueryClient({
                defaultOptions: {
                    queries: {
                        // Everything here is local state on one machine; stale
                        // views are just confusing, refetch cheaply instead.
                        staleTime: 5_000,
                        retry: 1,
                    },
                },
            }),
    )
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
}
