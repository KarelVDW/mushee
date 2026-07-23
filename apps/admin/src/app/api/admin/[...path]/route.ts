import { type NextRequest, NextResponse } from 'next/server'

import { SESSION_COOKIE, verifySessionToken } from '@/lib/session'

/**
 * Server-side proxy for the API's /admin endpoints. The browser only ever
 * holds the session cookie; this handler swaps it for the real console secret
 * (x-admin-secret) on the way through, so the secret stays server-side and
 * the API needs no CORS entry for the console.
 */

const API_URL = process.env.API_URL ?? 'http://localhost:4200'

async function forward(request: NextRequest, path: string[], method: 'GET' | 'POST' | 'DELETE') {
    const secret = process.env.ADMIN_SECRET
    if (!secret) {
        return NextResponse.json({ message: 'Admin console is disabled — set ADMIN_SECRET to enable it.' }, { status: 503 })
    }
    if (!(await verifySessionToken(request.cookies.get(SESSION_COOKIE)?.value, secret))) {
        return NextResponse.json({ message: 'Session expired — sign in again.' }, { status: 401 })
    }

    // Rebuild the upstream path from the matched segments (never from raw
    // user input) — encodeURIComponent keeps '..'-style tricks inert.
    const upstream = `${API_URL}/admin/${path.map(encodeURIComponent).join('/')}${request.nextUrl.search}`
    const body = method === 'GET' ? undefined : await request.text()

    let res: Response
    try {
        res = await fetch(upstream, {
            method,
            headers: {
                'x-admin-secret': secret,
                ...(body ? { 'Content-Type': 'application/json' } : {}),
            },
            body: body || undefined,
            cache: 'no-store',
            // Redirects go back to the browser untouched: recording audio
            // 302s to a signed bucket URL, and the <audio> element should
            // fetch the bytes straight from the bucket, not through us.
            redirect: 'manual',
        })
    } catch {
        return NextResponse.json({ message: "Can't reach the API." }, { status: 502 })
    }

    if (res.status >= 300 && res.status < 400) {
        const location = res.headers.get('Location')
        return new NextResponse(null, { status: res.status, headers: location ? { Location: location } : {} })
    }

    // Relay the body as a stream — most answers are JSON, but recording audio
    // from URL-less storage backends comes through here as raw bytes.
    return new NextResponse(res.body, {
        status: res.status,
        headers: { 'Content-Type': res.headers.get('Content-Type') ?? 'application/json' },
    })
}

type Context = { params: Promise<{ path: string[] }> }

export async function GET(request: NextRequest, context: Context) {
    return forward(request, (await context.params).path, 'GET')
}

export async function POST(request: NextRequest, context: Context) {
    return forward(request, (await context.params).path, 'POST')
}

export async function DELETE(request: NextRequest, context: Context) {
    return forward(request, (await context.params).path, 'DELETE')
}
