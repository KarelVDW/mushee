import { type NextRequest, NextResponse } from 'next/server'

import { withNext } from '@/lib/nextPath'

const publicPathPrefixes = ['/login', '/signup', '/reset-password', '/pricing', '/privacy', '/terms', '/contact', '/s']

// better-auth prefixes the cookie with __Secure- when its baseURL is HTTPS,
// so production and dev use different names — check both.
const sessionCookieNames = ['__Secure-better-auth.session_token', 'better-auth.session_token']

// Prefix matches stop at path-segment boundaries so e.g. a future
// '/contact-sales' route isn't silently public because of '/contact'.
function isPublic(pathname: string): boolean {
    // '/' must match exactly — as a prefix it would match every path and turn
    // this gate into a no-op.
    if (pathname === '/') return true
    return publicPathPrefixes.some((p) => pathname === p || pathname.startsWith(`${p}/`))
}

export function proxy(request: NextRequest) {
    const { pathname } = request.nextUrl

    if (isPublic(pathname)) {
        return NextResponse.next()
    }

    const hasSession = sessionCookieNames.some((name) => request.cookies.get(name))

    if (!hasSession) {
        // Carry the destination along so sign-in can return the user to the
        // deep link they followed instead of the scores list.
        return NextResponse.redirect(new URL(withNext('/login', pathname + request.nextUrl.search), request.url))
    }

    return NextResponse.next()
}

export const config = {
    matcher: [
        // Skip Next internals, the PostHog ingest proxy, the root OG image, and
        // any path with a file extension (public/ icons, favicon.ico,
        // apple-icon.png, sitemap.xml, robots.txt, manifest.webmanifest).
        '/((?!_next/|ingest/|opengraph-image|.*\\..*).*)',
    ],
}
