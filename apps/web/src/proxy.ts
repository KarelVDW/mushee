import { type NextRequest, NextResponse } from 'next/server'

// '/' must match exactly — as a prefix it would match every path and turn
// this gate into a no-op.
const publicExactPaths = ['/']
const publicPathPrefixes = ['/login', '/signup', '/reset-password', '/privacy', '/terms', '/contact']

export function proxy(request: NextRequest) {
    const { pathname } = request.nextUrl

    if (publicExactPaths.includes(pathname) || publicPathPrefixes.some((p) => pathname.startsWith(p))) {
        return NextResponse.next()
    }

    const sessionCookie = request.cookies.get('better-auth.session_token')

    if (!sessionCookie) {
        return NextResponse.redirect(new URL('/login', request.url))
    }

    return NextResponse.next()
}

export const config = {
    matcher: [
        // Skip static assets, SEO files, and the PostHog ingest proxy.
        '/((?!_next/static|_next/image|favicon.ico|icon.svg|api|ingest|sitemap.xml|robots.txt|manifest.webmanifest|opengraph-image).*)',
    ],
}
