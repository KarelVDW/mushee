'use client'

import type { ReactNode } from 'react'

import { TertiaryButton } from '@/components/ui'
import { useSession } from '@/lib/auth-client'

/** A quiet link to /login, shown to signed-out visitors only — a client island on the marketing pages. */
export function SignInLink({ children }: { children: ReactNode }) {
    const { data: session } = useSession()
    if (session?.user) return null
    return <TertiaryButton href="/login">{children}</TertiaryButton>
}
