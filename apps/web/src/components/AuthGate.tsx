'use client'

import { usePathname, useRouter } from 'next/navigation'
import { type ReactNode, useEffect } from 'react'

import { useSession } from '@/lib/auth-client'
import { useBetaGate } from '@/lib/queries'
import { isBetaAllowedPath, isPublicPath } from '@/lib/routes'

const ONBOARDING_PATH = '/onboarding'

export function AuthGate({ children }: { children: ReactNode }) {
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

    return <>{children}</>
}
