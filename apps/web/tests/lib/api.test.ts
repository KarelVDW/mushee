import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { api, createScore, deleteScore, getScore, listScores, loadScore, patchOnboarding, updateScore } from '@/lib/api'

const BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000'

function okResponse(body: unknown): Response {
    return {
        ok: true,
        status: 200,
        statusText: 'OK',
        json: () => Promise.resolve(body),
    } as unknown as Response
}

describe('api', () => {
    let fetchMock: ReturnType<typeof vi.fn>

    beforeEach(() => {
        fetchMock = vi.fn()
        vi.stubGlobal('fetch', fetchMock)
    })

    afterEach(() => {
        vi.unstubAllGlobals()
        vi.restoreAllMocks()
    })

    it('api() returns parsed JSON and sends JSON + credentials by default', async () => {
        fetchMock.mockResolvedValue(okResponse({ hello: 'world' }))
        const result = await api<{ hello: string }>('/ping')

        expect(result).toEqual({ hello: 'world' })
        const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
        expect(url).toBe(`${BASE}/ping`)
        expect(init.credentials).toBe('include')
        expect(init.headers).toMatchObject({ 'Content-Type': 'application/json' })
    })

    it('api() merges caller-supplied headers over the defaults', async () => {
        fetchMock.mockResolvedValue(okResponse({}))
        await api('/x', { headers: { Authorization: 'Bearer t' } })
        const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
        expect(init.headers).toMatchObject({ 'Content-Type': 'application/json', Authorization: 'Bearer t' })
    })

    it('api() throws "API error: ..." on a non-ok response', async () => {
        fetchMock.mockResolvedValue({
            ok: false,
            status: 404,
            statusText: 'Not Found',
            json: () => Promise.resolve(null),
        } as unknown as Response)

        await expect(api('/missing')).rejects.toThrow('API error: 404 Not Found')
    })

    it('listScores() hits /scores with no query when search is omitted', async () => {
        fetchMock.mockResolvedValue(okResponse([]))
        await listScores()
        expect(fetchMock.mock.calls[0][0]).toBe(`${BASE}/scores`)
    })

    it('listScores() URL-encodes the search query', async () => {
        fetchMock.mockResolvedValue(okResponse([]))
        await listScores('a b & c')
        expect(fetchMock.mock.calls[0][0]).toBe(`${BASE}/scores?search=a%20b%20%26%20c`)
    })

    it('getScore() requests /scores/:id', async () => {
        fetchMock.mockResolvedValue(okResponse({ id: '7' }))
        await getScore('7')
        expect(fetchMock.mock.calls[0][0]).toBe(`${BASE}/scores/7`)
    })

    it('loadScore() requests /scores/:id/load', async () => {
        fetchMock.mockResolvedValue(okResponse({}))
        await loadScore('7')
        expect(fetchMock.mock.calls[0][0]).toBe(`${BASE}/scores/7/load`)
    })

    it('createScore() POSTs title + score body to /scores', async () => {
        fetchMock.mockResolvedValue(okResponse({ id: '1' }))
        await createScore('My Piece', { foo: 1 })
        const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
        expect(url).toBe(`${BASE}/scores`)
        expect(init.method).toBe('POST')
        expect(JSON.parse(init.body as string)).toEqual({ title: 'My Piece', score: { foo: 1 } })
    })

    it('updateScore() PATCHes the provided data to /scores/:id', async () => {
        fetchMock.mockResolvedValue(okResponse({ id: '2' }))
        await updateScore('2', { title: 'Renamed', allMeasures: [1, 2] })
        const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
        expect(url).toBe(`${BASE}/scores/2`)
        expect(init.method).toBe('PATCH')
        expect(JSON.parse(init.body as string)).toEqual({ title: 'Renamed', allMeasures: [1, 2] })
    })

    it('deleteScore() sends DELETE to /scores/:id', async () => {
        fetchMock.mockResolvedValue(okResponse(undefined))
        await deleteScore('3')
        const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
        expect(url).toBe(`${BASE}/scores/3`)
        expect(init.method).toBe('DELETE')
    })

    it('patchOnboarding() PATCHes the patch body to /onboarding', async () => {
        fetchMock.mockResolvedValue(okResponse({}))
        await patchOnboarding({ background: 'pro', instruments: ['flute'] })
        const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
        expect(url).toBe(`${BASE}/onboarding`)
        expect(init.method).toBe('PATCH')
        expect(JSON.parse(init.body as string)).toEqual({ background: 'pro', instruments: ['flute'] })
    })
})
