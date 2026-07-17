import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
    approveBetaSignup,
    cancelSubscription,
    changePlan,
    createBillingPortalSession,
    createCheckout,
    getBetaStatus,
    getBillingState,
} from '@/lib/api'

const BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4200'

function okResponse(body: unknown): Response {
    const text = body === undefined ? '' : JSON.stringify(body)
    return {
        ok: true,
        status: 200,
        statusText: 'OK',
        text: () => Promise.resolve(text),
        json: () => (text ? Promise.resolve(JSON.parse(text)) : Promise.reject(new SyntaxError('Unexpected end of JSON input'))),
    } as unknown as Response
}

describe('billing & beta api client', () => {
    let fetchMock: ReturnType<typeof vi.fn>

    beforeEach(() => {
        fetchMock = vi.fn().mockResolvedValue(okResponse({}))
        vi.stubGlobal('fetch', fetchMock)
    })

    afterEach(() => {
        vi.unstubAllGlobals()
        vi.restoreAllMocks()
    })

    function lastCall(): [string, RequestInit] {
        return fetchMock.mock.calls[0] as [string, RequestInit]
    }

    it('getBillingState GETs /billing/subscription', async () => {
        await getBillingState()
        expect(lastCall()[0]).toBe(`${BASE}/billing/subscription`)
    })

    it('createCheckout POSTs tier and interval', async () => {
        await createCheckout('pro', 'yearly')
        const [url, init] = lastCall()
        expect(url).toBe(`${BASE}/billing/checkout`)
        expect(init.method).toBe('POST')
        expect(JSON.parse(init.body as string)).toEqual({ tierId: 'pro', interval: 'yearly' })
    })

    it('changePlan POSTs to /billing/change', async () => {
        await changePlan('studio', 'monthly')
        const [url, init] = lastCall()
        expect(url).toBe(`${BASE}/billing/change`)
        expect(JSON.parse(init.body as string)).toEqual({ tierId: 'studio', interval: 'monthly' })
    })

    it('portal and cancel send non-empty JSON bodies (fastify rejects empty)', async () => {
        await createBillingPortalSession()
        expect(lastCall()[1].body).toBe('{}')

        fetchMock.mockClear()
        await cancelSubscription()
        expect(lastCall()[1].body).toBe('{}')
    })

    it('getBetaStatus GETs /beta/status', async () => {
        await getBetaStatus()
        expect(lastCall()[0]).toBe(`${BASE}/beta/status`)
    })

    it('approveBetaSignup POSTs to the admin route', async () => {
        await approveBetaSignup('user-1')
        const [url, init] = lastCall()
        expect(url).toBe(`${BASE}/admin/beta/signups/user-1/approve`)
        expect(init.method).toBe('POST')
    })
})
