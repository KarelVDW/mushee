'use client'

import { RestBarMark } from '@/components/RestBarMark'
import { ErrorScreen } from '@/components/ui'
import { useSession } from '@/lib/auth-client'
import { LIBRARY_PATH } from '@/lib/nextPath'

const MESSAGE = 'The link may be old, or the address was mistyped.'

/**
 * The 404 screen, which depends on the session: a signed-in visitor is told their scores are
 * safe and goes back to the library; a signed-out one (a mistyped public address) goes to the
 * home page, with sign-in as the second way in — never to a library they may not have. A
 * missing page is not a fault, so it is the neutral `missing` screen with the empty bar. The
 * buttons wait for the session, so neither set flashes in for the other; their row keeps its
 * height meanwhile.
 */
export function NotFoundActions() {
    const { data: session, isPending } = useSession()
    const authed = !!session?.user
    const actions = isPending
        ? { secondaryAction: <span aria-hidden className="block h-(--control-md)" /> }
        : authed
          ? { backHref: LIBRARY_PATH, backLabel: 'Back to your library', secondaryAction: { label: 'Go home', href: '/' } }
          : { backHref: '/', backLabel: 'Go to the home page', secondaryAction: { label: 'Sign in', href: '/login' } }
    return (
        <ErrorScreen
            tone="missing"
            illustration={<RestBarMark />}
            title="This page doesn't exist"
            message={authed ? `${MESSAGE} Your scores are safe.` : MESSAGE}
            {...actions}
        />
    )
}
