'use client'

import { usePathname, useRouter } from 'next/navigation'
import { type ReactNode, useEffect } from 'react'

import { useSession } from '@/lib/auth-client'
import { BETA_MODE } from '@/lib/plans'
import { useBetaStatus } from '@/lib/queries'
import { isBetaAllowedPath, isPublicPath } from '@/lib/routes'

const ONBOARDING_PATH = '/onboarding'

export function AuthGate({ children }: { children: ReactNode }) {
    const router = useRouter()
    const pathname = usePathname()
    const { data: session, isPending } = useSession()
    // Always fetch when signed in: the server's betaMode is the runtime truth,
    // while BETA_MODE is baked in at build time — gating only on the build
    // flag lets the two drift (e.g. API in beta mode, web image built without).
    const betaStatus = useBetaStatus({ enabled: !!session?.user })

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
        if (
            (BETA_MODE || betaStatus.data?.betaMode) &&
            betaStatus.data?.status === 'pending' &&
            !isBetaAllowedPath(pathname)
        ) {
            router.replace('/beta')
        }
    }, [isPending, session, pathname, router, isPublic, betaStatus.data])

    return <>{children}</>
}
