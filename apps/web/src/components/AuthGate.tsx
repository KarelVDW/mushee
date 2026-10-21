'use client'

import { usePathname, useRouter } from 'next/navigation'
import { useEffect } from 'react'

import { useSession } from '@/lib/auth-client'
import { useBetaGate } from '@/lib/queries'
import { isBetaAllowedPath, isPublicPath } from '@/lib/routes'

const ONBOARDING_PATH = '/onboarding'

/**
 * Client-side counterpart of the edge proxy: sends signed-in users who still
 * owe a step (email verification, beta approval) to where they can take it.
 * Effects only — it wraps nothing and renders nothing.
 */
export function AuthGate() {
    const router = useRouter()
    const pathname = usePathname()
    const { data: session, isPending } = useSession()
    // Always fetch when signed in: the server's betaMode is the runtime truth,
    // while BETA_MODE is baked in at build time and can drift from it.
    const { awaitingApproval } = useBetaGate({ enabled: !!session?.user })

    const isPublic = isPublicPath(pathname)

    useEffect(() => {
        if (isPending) return
        if (!session?.user) return
        if (isPublic) return

        if (!session.user.emailVerified) {
            if (pathname !== ONBOARDING_PATH) router.replace(ONBOARDING_PATH)
            return
        }

        // Closed beta: unapproved users wait on /beta instead of the app.
        if (awaitingApproval && !isBetaAllowedPath(pathname)) {
            router.replace('/beta')
        }
    }, [isPending, session, pathname, router, isPublic, awaitingApproval])

    return null
}
