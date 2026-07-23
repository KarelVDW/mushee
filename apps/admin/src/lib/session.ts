/**
 * Console sessions: after a correct secret at /login, the server sets an
 * HttpOnly cookie holding `expiresAtMs.hmac` — the HMAC (keyed with
 * ADMIN_SECRET itself) covers the expiry, so tokens can't be forged or
 * extended without knowing the secret. Web Crypto only, so the same code runs
 * in the proxy (edge) and in route handlers (node).
 */

export const SESSION_COOKIE = 'solkey_admin_session'

const DEFAULT_SESSION_HOURS = 12

export function sessionMaxAgeSeconds(): number {
    const hours = Number(process.env.ADMIN_SESSION_HOURS ?? DEFAULT_SESSION_HOURS)
    return Math.round((Number.isFinite(hours) && hours > 0 ? hours : DEFAULT_SESSION_HOURS) * 3600)
}

export async function createSessionToken(secret: string): Promise<string> {
    const expiresAt = Date.now() + sessionMaxAgeSeconds() * 1000
    return `${expiresAt}.${await sign(String(expiresAt), secret)}`
}

export async function verifySessionToken(token: string | undefined, secret: string | undefined): Promise<boolean> {
    if (!token || !secret) return false
    const [expiry, mac] = token.split('.')
    if (!expiry || !mac) return false
    const expiresAt = Number(expiry)
    if (!Number.isFinite(expiresAt) || expiresAt < Date.now()) return false
    return constantTimeEqual(await sign(expiry, secret), mac)
}

async function sign(payload: string, secret: string): Promise<string> {
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, [
        'sign',
    ])
    const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`solkey-admin-session:${payload}`))
    return Array.from(new Uint8Array(mac))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('')
}

function constantTimeEqual(a: string, b: string): boolean {
    if (a.length !== b.length) return false
    let diff = 0
    for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
    return diff === 0
}
