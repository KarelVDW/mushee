'use client'

import { type ReactNode, useEffect, useRef } from 'react'

import { identifyUser, initAnalytics, resetAnalyticsIdentity } from '@/lib/analytics'
import { useSession } from '@/lib/auth-client'

/**
 * Boots PostHog (consent-gated inside initAnalytics) and keeps the analytics
 * identity in sync with the auth session: identify on sign-in, reset on
 * sign-out.
 */
export function AnalyticsProvider({ children }: { children: ReactNode }) {
    const { data: session, isPending } = useSession()
    const lastUserId = useRef<string | null>(null)

    useEffect(() => {
        initAnalytics()
    }, [])

    useEffect(() => {
        if (isPending) return
        const user = session?.user
        if (user) {
            lastUserId.current = user.id
            identifyUser({ id: user.id, email: user.email, name: user.name })
        } else if (lastUserId.current) {
            lastUserId.current = null
            resetAnalyticsIdentity()
        }
    }, [session, isPending])

    return <>{children}</>
}
