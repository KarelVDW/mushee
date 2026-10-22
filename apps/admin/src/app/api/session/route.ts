import { type NextRequest, NextResponse } from 'next/server'

import { createSessionToken, secretMatches, SESSION_COOKIE, sessionMaxAgeSeconds } from '@/lib/session'

/**
 * Sign in: exchange the console secret for the session cookie. The secret is
 * compared here and never echoed back; the cookie only proves the exchange
 * happened (see lib/session.ts).
 */

// Small in-process brake against secret guessing: after 5 straight failures
// per IP, every further attempt waits out a 30s cooldown. Deliberately
// memory-only — a restart resets it, which is fine for a single-admin tool.
const FAILURE_LIMIT = 5
const COOLDOWN_MS = 30_000
const failures = new Map<string, { count: number; lastAt: number }>()

function clientKey(request: NextRequest): string {
    return request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'local'
}

export async function POST(request: NextRequest) {
    const secret = process.env.ADMIN_SECRET
    if (!secret) {
        return NextResponse.json({ message: 'Admin console is disabled — set ADMIN_SECRET to enable it.' }, { status: 503 })
    }

    const key = clientKey(request)
    const recent = failures.get(key)
    if (recent && recent.count >= FAILURE_LIMIT && Date.now() - recent.lastAt < COOLDOWN_MS) {
        return NextResponse.json({ message: 'Too many attempts — wait half a minute and try again.' }, { status: 429 })
    }

    let provided: unknown
    try {
        provided = ((await request.json()) as { secret?: unknown }).secret
    } catch {
        provided = undefined
    }

    if (typeof provided !== 'string' || !(await secretMatches(provided, secret))) {
        // Re-read after the awaits rather than incrementing `recent`: concurrent
        // failures from the same IP each land on the latest count, so a burst of
        // parallel guesses is counted in full.
        const entry = failures.get(key)
        failures.set(key, { count: (entry?.count ?? 0) + 1, lastAt: Date.now() })
        return NextResponse.json({ message: "That secret didn't match." }, { status: 401 })
    }

    failures.delete(key)
    const response = NextResponse.json({ ok: true })
    response.cookies.set(SESSION_COOKIE, await createSessionToken(secret), {
        httpOnly: true,
        sameSite: 'lax',
        secure: process.env.NODE_ENV === 'production',
        path: '/',
        maxAge: sessionMaxAgeSeconds(),
    })
    return response
}

export function DELETE() {
    const response = NextResponse.json({ ok: true })
    response.cookies.delete(SESSION_COOKIE)
    return response
}
