'use client'

import Link from 'next/link'
import type { ReactNode } from 'react'

import { useSession } from '@/lib/auth-client'

/**
 * A quiet link to /login, shown to signed-out visitors only — a client island on the marketing
 * pages. It takes its look from the caller, so it matches the text links around it.
 */
export function SignInLink({ className, children }: { className: string; children: ReactNode }) {
    const { data: session } = useSession()
    if (session?.user) return null
    return (
        <Link href="/login" className={className}>
            {children}
        </Link>
    )
}
