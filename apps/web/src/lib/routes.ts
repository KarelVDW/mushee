/**
 * Which pages need what: the one route policy shared by the edge proxy
 * (src/proxy.ts) and the client-side AuthGate. Keep this module free of
 * client-only imports — the proxy loads it.
 *
 * sitemap.ts and robots.ts keep their own lists on purpose: they answer
 * different questions (what to index, what crawlers should skip).
 */

/** Pages a signed-out visitor may open. '/' is matched exactly — see isPublicPath. */
export const PUBLIC_PATH_PREFIXES = ['/login', '/signup', '/reset-password', '/pricing', '/privacy', '/terms', '/contact', '/s'] as const

/** Paths a pending beta user may still visit while waiting for approval. */
export const BETA_ALLOWED_PATH_PREFIXES = ['/beta', '/onboarding', '/settings'] as const

// Prefix matches stop at path-segment boundaries so e.g. a future
// '/contact-sales' route isn't silently public because of '/contact', and
// '/s' (share links) doesn't open up /scores, /settings or /signup.
function matchesPrefix(pathname: string, prefixes: readonly string[]): boolean {
    return prefixes.some((p) => pathname === p || pathname.startsWith(`${p}/`))
}

export function isPublicPath(pathname: string): boolean {
    // '/' must match exactly — as a prefix it would match every path and turn
    // the gate into a no-op.
    return pathname === '/' || matchesPrefix(pathname, PUBLIC_PATH_PREFIXES)
}

export function isBetaAllowedPath(pathname: string): boolean {
    return matchesPrefix(pathname, BETA_ALLOWED_PATH_PREFIXES)
}
