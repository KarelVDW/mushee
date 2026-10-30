'use client'

import { createQueryClient } from '@mushee/ui/queryClient'
import { QueryClientProvider } from '@tanstack/react-query'
import { useState } from 'react'

/** React Query for the few client-side reads (a clip's cached pipeline notes); the pages render on the server. */
export function Providers({ children }: { children: React.ReactNode }) {
    const [queryClient] = useState(createQueryClient)
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
}
