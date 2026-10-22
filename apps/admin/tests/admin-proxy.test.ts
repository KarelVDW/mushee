import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// The route reads API_URL once at module load, so it is set before the import below runs.
vi.hoisted(() => {
    process.env.API_URL = 'http://api.test'
})

import { GET, POST } from '../src/app/api/admin/[...path]/route'
import { api, ApiError } from '../src/lib/api'
import { createSessionToken, SESSION_COOKIE } from '../src/lib/session'

const SECRET = 'test-console-secret'
const MISMATCH = 'The API rejected the console secret — ADMIN_SECRET differs between apps/admin and apps/api.'

const fetchMock = vi.fn<typeof fetch>()

function context(...path: string[]) {
    return { params: Promise.resolve({ path }) }
}

async function signedRequest(url: string, init: { method?: string; body?: string } = {}): Promise<NextRequest> {
    const token = await createSessionToken(SECRET)
    return new NextRequest(url, { ...init, headers: { cookie: `${SESSION_COOKIE}=${token}` } })
}

function json(body: unknown, status: number): Response {
    return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

/** The one upstream call the proxy made: its URL and init. */
function upstreamCall(): { url: string; init: RequestInit } {
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    // The proxy builds the upstream URL as a string.
    expect(typeof url).toBe('string')
    return { url: url as string, init: init ?? {} }
}

beforeEach(() => {
    process.env.ADMIN_SECRET = SECRET
    vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
    delete process.env.ADMIN_SECRET
    fetchMock.mockReset()
    vi.unstubAllGlobals()
    vi.useRealTimers()
})

describe('admin API proxy', () => {
    it('answers 503 without calling the API when ADMIN_SECRET is unset', async () => {
        delete process.env.ADMIN_SECRET
        const res = await GET(await signedRequest('http://admin.test/api/admin/stats'), context('stats'))
        expect(res.status).toBe(503)
        expect(fetchMock).not.toHaveBeenCalled()
    })

    it("answers its own 401 'Session expired' for a missing cookie", async () => {
        const res = await GET(new NextRequest('http://admin.test/api/admin/stats'), context('stats'))
        expect(res.status).toBe(401)
        await expect(res.json()).resolves.toEqual({ message: 'Session expired — sign in again.' })
        expect(fetchMock).not.toHaveBeenCalled()
    })

    it("answers its own 401 'Session expired' for an expired cookie", async () => {
        vi.useFakeTimers({ toFake: ['Date'] })
        vi.setSystemTime(new Date('2026-01-01T00:00:00Z'))
        const request = await signedRequest('http://admin.test/api/admin/stats')
        vi.setSystemTime(new Date('2026-01-02T00:00:00Z'))
        const res = await GET(request, context('stats'))
        expect(res.status).toBe(401)
        await expect(res.json()).resolves.toEqual({ message: 'Session expired — sign in again.' })
        expect(fetchMock).not.toHaveBeenCalled()
    })

    it('maps an upstream 401 to a 502 naming the secret mismatch, so the client never loops to login', async () => {
        fetchMock.mockResolvedValue(json({ message: 'Unauthorized' }, 401))
        const res = await GET(await signedRequest('http://admin.test/api/admin/stats'), context('stats'))
        expect(res.status).toBe(502)
        await expect(res.json()).resolves.toEqual({ message: MISMATCH })
    })

    it('forwards a GET with the secret, the encoded path and the query, and no body or Content-Type', async () => {
        fetchMock.mockResolvedValue(json({ id: 'u/1' }, 200))
        const res = await GET(await signedRequest('http://admin.test/api/admin/users/u%2F1?tab=scores'), context('users', 'u/1'))

        const { url, init } = upstreamCall()
        expect(url).toBe('http://api.test/admin/users/u%2F1?tab=scores')
        expect(init.method).toBe('GET')
        expect(init.body).toBeUndefined()
        expect(init.headers).toEqual({ 'x-admin-secret': SECRET })
        expect(init.redirect).toBe('manual')
        expect(res.status).toBe(200)
        await expect(res.json()).resolves.toEqual({ id: 'u/1' })
    })

    it('sends a body-less POST without a Content-Type', async () => {
        fetchMock.mockResolvedValue(json({ ok: true }, 200))
        await POST(
            await signedRequest('http://admin.test/api/admin/sessions/u1/revoke', { method: 'POST' }),
            context('sessions', 'u1', 'revoke'),
        )

        const { init } = upstreamCall()
        expect(init.method).toBe('POST')
        expect(init.body).toBeUndefined()
        expect(init.headers).toEqual({ 'x-admin-secret': SECRET })
    })

    it('forwards a POST body as JSON', async () => {
        fetchMock.mockResolvedValue(json({ ok: true }, 200))
        const body = JSON.stringify({ minutes: 30 })
        await POST(
            await signedRequest('http://admin.test/api/admin/users/u1/packs', { method: 'POST', body }),
            context('users', 'u1', 'packs'),
        )

        const { init } = upstreamCall()
        expect(init.body).toBe(body)
        expect(init.headers).toEqual({ 'x-admin-secret': SECRET, 'Content-Type': 'application/json' })
    })

    it('hands an upstream redirect back to the browser untouched', async () => {
        fetchMock.mockResolvedValue(new Response(null, { status: 302, headers: { Location: 'https://bucket.test/take.webm' } }))
        const res = await GET(await signedRequest('http://admin.test/api/admin/recordings/r1/audio'), context('recordings', 'r1', 'audio'))
        expect(res.status).toBe(302)
        expect(res.headers.get('Location')).toBe('https://bucket.test/take.webm')
    })

    it("answers 502 when the API can't be reached", async () => {
        fetchMock.mockRejectedValue(new TypeError('fetch failed'))
        const res = await GET(await signedRequest('http://admin.test/api/admin/stats'), context('stats'))
        expect(res.status).toBe(502)
        await expect(res.json()).resolves.toEqual({ message: "Can't reach the API." })
    })
})

describe('api() session-expiry redirect', () => {
    const assign = vi.fn<(url: string) => void>()

    beforeEach(() => {
        assign.mockReset()
        vi.stubGlobal('window', { location: { pathname: '/users/u1', search: '?tab=scores', assign } })
    })

    it('sends a 401 from an admin data route to the login screen, returning to the current page', async () => {
        fetchMock.mockResolvedValue(json({ message: 'Session expired — sign in again.' }, 401))
        await expect(api('/api/admin/users/u1')).rejects.toBeInstanceOf(ApiError)
        expect(assign).toHaveBeenCalledWith('/login?next=%2Fusers%2Fu1%3Ftab%3Dscores')
    })

    it('stays put on the proxy’s secret-mismatch 502', async () => {
        fetchMock.mockResolvedValue(json({ message: MISMATCH }, 502))
        await expect(api('/api/admin/stats')).rejects.toMatchObject({ status: 502, message: MISMATCH })
        expect(assign).not.toHaveBeenCalled()
    })

    it('stays put on a 401 outside the admin data routes (a wrong secret at sign-in)', async () => {
        fetchMock.mockResolvedValue(json({ message: 'Wrong secret.' }, 401))
        await expect(api('/api/session', { method: 'POST', body: '{}' })).rejects.toMatchObject({ status: 401 })
        expect(assign).not.toHaveBeenCalled()
    })
})
