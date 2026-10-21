import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
    cancelSubscription,
    changePlan,
    createBillingPortalSession,
    createCheckout,
    getBetaStatus,
    getBillingState,
    reactivateAccount,
    resumeSubscription,
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

    it('body-less POSTs (portal, cancel, resume, reactivate) send no body and claim no JSON content-type', async () => {
        const cases: [() => Promise<unknown>, string][] = [
            [createBillingPortalSession, '/billing/portal'],
            [cancelSubscription, '/billing/cancel'],
            [resumeSubscription, '/billing/resume'],
            [reactivateAccount, '/account/reactivate'],
        ]
        for (const [call, path] of cases) {
            fetchMock.mockClear()
            await call()
            const [url, init] = lastCall()
            expect(url).toBe(`${BASE}${path}`)
            expect(init.method).toBe('POST')
            expect(init.body).toBeUndefined()
            expect(init.headers).not.toHaveProperty('Content-Type')
        }
    })

    it('getBetaStatus GETs /beta/status', async () => {
        await getBetaStatus()
        expect(lastCall()[0]).toBe(`${BASE}/beta/status`)
    })
})
