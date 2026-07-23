import { type NextRequest, NextResponse } from 'next/server'

import { SESSION_COOKIE, verifySessionToken } from '@/lib/session'

// Everything is private except the login screen; /api has its own checks
// (see the matcher below) and does not belong to the page gate.
const publicPathPrefixes = ['/login']

function isPublic(pathname: string): boolean {
    return publicPathPrefixes.some((p) => pathname === p || pathname.startsWith(`${p}/`))
}

export async function proxy(request: NextRequest) {
    const { pathname } = request.nextUrl

    if (isPublic(pathname)) {
        return NextResponse.next()
    }

    // Full HMAC verification, not just cookie presence — the token is
    // self-contained, so the gate needs no backend round trip.
    const token = request.cookies.get(SESSION_COOKIE)?.value
    const valid = await verifySessionToken(token, process.env.ADMIN_SECRET)

    if (!valid) {
        const login = new URL('/login', request.url)
        if (pathname !== '/') {
            login.searchParams.set('next', pathname + request.nextUrl.search)
        }
        return NextResponse.redirect(login)
    }

    return NextResponse.next()
}

export const config = {
    matcher: [
        // Skip static assets and /api — API routes verify the session cookie
        // themselves and must answer 401 (JSON), not a login redirect (HTML).
        '/((?!_next/static|_next/image|favicon.ico|icon.svg|api).*)',
    ],
}
