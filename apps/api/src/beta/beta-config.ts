/**
 * Signup policy and closed-beta launch switches: what a new account gets.
 * All read from the environment so the beta flow can be toggled without a
 * deploy artifact change:
 *
 * - BETA_MODE=true      → signups join a waitlist on the 'beta' tier and must
 *                         be approved by an admin before they can use the app.
 * - ADMIN_EMAILS=a,b    → accounts created with these emails are auto-approved,
 *                         start on the Studio tier, receive the waitlist signup
 *                         notifications and are labelled admins (role 'admin',
 *                         shown in the admin console). The label grants no API
 *                         access: the admin API is gated by ADMIN_SECRET.
 *
 * The web app mirrors the toggle as NEXT_PUBLIC_BETA_MODE.
 *
 * Deliberately a plain module rather than a Nest provider: the signup policy
 * must be readable from auth.config.ts (better-auth's config object is built
 * outside the DI container), and from billing without pulling BetaModule into
 * its dependency graph.
 */

export type BetaStatus = 'pending' | 'approved'

export function isBetaMode(): boolean {
    return process.env.BETA_MODE === 'true'
}

export function adminEmails(): string[] {
    return (process.env.ADMIN_EMAILS ?? '')
        .split(',')
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean)
}

export function isAdminEmail(email: string): boolean {
    return adminEmails().includes(email.toLowerCase())
}

/** Fields stamped onto a new user row at signup. */
export function signupUserFields(email: string): {
    role: 'user' | 'admin'
    betaStatus: BetaStatus | null
} {
    const admin = isAdminEmail(email)
    if (!isBetaMode()) {
        return { role: admin ? 'admin' : 'user', betaStatus: null }
    }
    return {
        role: admin ? 'admin' : 'user',
        betaStatus: admin ? 'approved' : 'pending',
    }
}

/** Tier a fresh signup lands on: Studio for admins, else beta or free by BETA_MODE. */
export function signupTierId(email: string): 'studio' | 'beta' | 'free' {
    if (isAdminEmail(email)) return 'studio'
    return isBetaMode() ? 'beta' : 'free'
}
