import { emailOTPClient } from 'better-auth/client/plugins'
import { createAuthClient } from 'better-auth/react'
import { useSyncExternalStore } from 'react'

import { API_URL } from './env'

const authClient = createAuthClient({
    baseURL: API_URL,
    plugins: [emailOTPClient()],
})

export const { signIn, signUp, signOut, useSession, changePassword, requestPasswordReset, resetPassword, emailOtp, updateUser } = authClient

const subscribeNever = () => () => {}

/**
 * `useSession` for markup the server also renders (the marketing pages). The server never
 * knows the session, but better-auth can already hold one when the client hydrates, so a plain
 * `useSession` branch makes the hydration render disagree with the server's HTML (React's
 * hydration error, seen on the signed-in landing page). This reports no session for the
 * hydration render — the server snapshot — and the real state on the render right after.
 */
export function useHydratedSession(): ReturnType<typeof useSession> {
    const hydrated = useSyncExternalStore(
        subscribeNever,
        () => true,
        () => false,
    )
    const session = useSession()
    return hydrated ? session : { ...session, data: null }
}
