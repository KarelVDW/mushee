'use client'

import { usePathname, useRouter } from 'next/navigation'
import { type ReactNode, useEffect } from 'react'

import { useSession } from '@/lib/auth-client'

const PUBLIC_PATH_PREFIXES = ['/login', '/signup', '/reset-password']
const PUBLIC_EXACT_PATHS = ['/']
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
        if (PUBLIC_EXACT_PATHS.includes(pathname)) return
        if (PUBLIC_PATH_PREFIXES.some((p) => pathname.startsWith(p))) return
        router.replace(ONBOARDING_PATH)
    }, [isPending, session, pathname, router])

    return <>{children}</>
}
