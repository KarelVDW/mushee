'use client'

import { PrimaryButton, SecondaryButton, TertiaryButton } from '@/components/ui'
import { useSession } from '@/lib/auth-client'
import { LIBRARY_PATH } from '@/lib/nextPath'

/**
 * The 404's session-dependent part: a signed-in visitor is told their scores are safe and
 * goes back to the library; a signed-out one (a mistyped public address) goes to the home
 * page, with sign-in as the quiet alternative — never to a library they may not have. The
 * buttons wait for the session, so neither set flashes in for the other.
 */
export function NotFoundActions() {
    const { data: session, isPending } = useSession()
    const authed = !!session?.user
    return (
        <>
            <p className="font-body font-normal text-[14px] leading-normal text-on-surface-variant m-0">
                The link may be old, or the address was mistyped.{authed && ' Your scores are safe.'}
            </p>
            <div className="flex flex-wrap items-center justify-center gap-3 mt-2 min-h-10">
                {isPending ? null : authed ? (
                    <>
                        <PrimaryButton href={LIBRARY_PATH}>Back to your library</PrimaryButton>
                        <SecondaryButton href="/">Go home</SecondaryButton>
                    </>
                ) : (
                    <>
                        <PrimaryButton href="/">Go to the home page</PrimaryButton>
                        <TertiaryButton href="/login">Sign in</TertiaryButton>
                    </>
                )}
            </div>
        </>
    )
}
