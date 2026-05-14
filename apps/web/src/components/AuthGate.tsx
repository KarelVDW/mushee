'use client'

import { usePathname, useRouter } from 'next/navigation'
import { type ReactNode, useEffect } from 'react'

import { useSession } from '@/lib/auth-client'

const PUBLIC_PATHS = ['/login', '/signup', '/reset-password']
const ONBOARDING_PATH = '/onboarding'

export function AuthGate({ children }: { children: ReactNode }) {
    const router = useRouter()
    const pathname = usePathname()
    const { data: session, isPending } = useSession()

    useEffect(() => {
        if (isPending) return
        if (!session?.user) return
        if (session.user.emailVerified) return
        if (pathname === ONBOARDING_PATH) return
        if (PUBLIC_PATHS.some((p) => pathname.startsWith(p))) return
        router.replace(ONBOARDING_PATH)
    }, [isPending, session, pathname, router])

    return <>{children}</>
}
