import { type NextRequest, NextResponse } from 'next/server'

import { createSessionToken, SESSION_COOKIE, sessionMaxAgeSeconds } from '@/lib/session'

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

    if (typeof provided !== 'string' || !(await constantTimeEqual(provided, secret))) {
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
    response.cookies.set(SESSION_COOKIE, '', { httpOnly: true, path: '/', maxAge: 0 })
    return response
}

/** HMAC both sides with a throwaway key: equal-length digests make the final
 *  comparison timing-independent of how much of the secret was guessed. */
async function constantTimeEqual(a: string, b: string): Promise<boolean> {
    const key = await crypto.subtle.generateKey({ name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
    const encoder = new TextEncoder()
    const [macA, macB] = await Promise.all([
        crypto.subtle.sign('HMAC', key, encoder.encode(a)),
        crypto.subtle.sign('HMAC', key, encoder.encode(b)),
    ])
    const bytesA = new Uint8Array(macA)
    const bytesB = new Uint8Array(macB)
    let diff = 0
    for (let i = 0; i < bytesA.length; i++) diff |= bytesA[i] ^ bytesB[i]
    return diff === 0
}
