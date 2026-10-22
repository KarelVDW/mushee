'use client'

import { Toaster } from '@mushee/ui'
import { createQueryClient } from '@mushee/ui/queryClient'
import { QueryClientProvider } from '@tanstack/react-query'
import { type ReactNode, useState } from 'react'

export function Providers({ children }: { children: ReactNode }) {
    // useState ensures one client per browser session, stable across re-renders.
    const [queryClient] = useState(createQueryClient)

    return (
        <QueryClientProvider client={queryClient}>
            {children}
            <Toaster />
        </QueryClientProvider>
    )
}
