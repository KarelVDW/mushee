import { type NextRequest, NextResponse } from 'next/server'

// '/' must match exactly — as a prefix it would match every path and turn
// this gate into a no-op.
const publicExactPaths = ['/']
const publicPathPrefixes = ['/login', '/signup', '/reset-password', '/privacy', '/terms', '/contact']

// better-auth prefixes the cookie with __Secure- when its baseURL is HTTPS,
// so production and dev use different names — check both.
const sessionCookieNames = ['__Secure-better-auth.session_token', 'better-auth.session_token']

// Prefix matches stop at path-segment boundaries so e.g. a future
// '/contact-sales' route isn't silently public because of '/contact'.
function isPublic(pathname: string): boolean {
    if (publicExactPaths.includes(pathname)) return true
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
        const login = new URL('/login', request.url)
        if (pathname !== '/scores') {
            login.searchParams.set('next', pathname + request.nextUrl.search)
        }
        return NextResponse.redirect(login)
    }

    return NextResponse.next()
}

export const config = {
    matcher: [
        // Skip static assets, SEO files, and the PostHog ingest proxy.
        '/((?!_next/static|_next/image|favicon.ico|icon.svg|api|ingest|sitemap.xml|robots.txt|manifest.webmanifest|opengraph-image).*)',
    ],
}
