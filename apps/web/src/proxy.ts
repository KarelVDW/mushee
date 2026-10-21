import { type NextRequest, NextResponse } from 'next/server'

import { withNext } from '@/lib/nextPath'
import { isPublicPath } from '@/lib/routes'

// better-auth prefixes the cookie with __Secure- when its baseURL is HTTPS,
// so production and dev use different names — check both.
const sessionCookieNames = ['__Secure-better-auth.session_token', 'better-auth.session_token']

export function proxy(request: NextRequest) {
    const { pathname } = request.nextUrl

    if (isPublicPath(pathname)) {
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
