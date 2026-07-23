import { afterEach, describe, expect, it, vi } from 'vitest'

import { createSessionToken, sessionMaxAgeSeconds, verifySessionToken } from '../src/lib/session'

const SECRET = 'test-console-secret'

afterEach(() => {
    delete process.env.ADMIN_SESSION_HOURS
    vi.useRealTimers()
})

describe('admin session tokens', () => {
    it('round-trips: a freshly created token verifies', async () => {
        const token = await createSessionToken(SECRET)
        await expect(verifySessionToken(token, SECRET)).resolves.toBe(true)
    })

    it('rejects a token signed with a different secret', async () => {
        const token = await createSessionToken('other-secret')
        await expect(verifySessionToken(token, SECRET)).resolves.toBe(false)
    })

    it('rejects tampering with the expiry', async () => {
        const token = await createSessionToken(SECRET)
        const [expiry, mac] = token.split('.')
        const extended = `${Number(expiry) + 3_600_000}.${mac}`
        await expect(verifySessionToken(extended, SECRET)).resolves.toBe(false)
    })

    it('rejects expired tokens', async () => {
        vi.useFakeTimers()
        const token = await createSessionToken(SECRET)
        vi.advanceTimersByTime(sessionMaxAgeSeconds() * 1000 + 1000)
        await expect(verifySessionToken(token, SECRET)).resolves.toBe(false)
    })

    it('rejects garbage and missing input', async () => {
        await expect(verifySessionToken(undefined, SECRET)).resolves.toBe(false)
        await expect(verifySessionToken('', SECRET)).resolves.toBe(false)
        await expect(verifySessionToken('not-a-token', SECRET)).resolves.toBe(false)
        await expect(verifySessionToken('123.deadbeef', SECRET)).resolves.toBe(false)
        await expect(verifySessionToken(await createSessionToken(SECRET), undefined)).resolves.toBe(false)
    })

    it('honors ADMIN_SESSION_HOURS and falls back on nonsense', () => {
        process.env.ADMIN_SESSION_HOURS = '2'
        expect(sessionMaxAgeSeconds()).toBe(2 * 3600)
        process.env.ADMIN_SESSION_HOURS = '-5'
        expect(sessionMaxAgeSeconds()).toBe(12 * 3600)
        process.env.ADMIN_SESSION_HOURS = 'soon'
        expect(sessionMaxAgeSeconds()).toBe(12 * 3600)
    })
})
