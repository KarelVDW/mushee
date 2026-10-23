'use client'

import { createQueryClient } from '@mushee/ui/queryClient'
import { QueryClientProvider, useQueryClient } from '@tanstack/react-query'
import { type ReactNode, useEffect, useRef, useState } from 'react'

import { AnalyticsIdentitySync } from '@/components/AnalyticsIdentitySync'
import { BrowserSupportBanner } from '@/components/BrowserSupportBanner'
import { CookieConsent } from '@/components/CookieConsent'
import { Toaster } from '@/components/ui'
import { useSession } from '@/lib/auth-client'

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

/**
 * iOS Safari applies `:active` only once the document has a touch listener, so without one no
 * button shows its pressed state under a finger. One passive no-op listener turns it on app-wide.
 */
function useTouchActiveStates() {
    useEffect(() => {
        const noop = () => {}
        document.addEventListener('touchstart', noop, { passive: true })
        return () => document.removeEventListener('touchstart', noop)
    }, [])
}

export function Providers({ children }: { children: ReactNode }) {
    // useState ensures one client per browser session, stable across re-renders.
    const [queryClient] = useState(createQueryClient)
    useTouchActiveStates()

    return (
        <QueryClientProvider client={queryClient}>
            <SessionCacheScope />
            {/* First, ahead of the page: in the flow on document pages, so it covers no nav or CTA. */}
            <BrowserSupportBanner />
            {children}
            <Toaster />
            <AnalyticsIdentitySync />
            <CookieConsent />
        </QueryClientProvider>
    )
}
