import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ApiError, NetworkError, requestJson } from '../src/http'

function response(status: number, body: string, statusText = ''): Response {
    return new Response(body || null, { status, statusText, headers: body ? { 'Content-Type': 'application/json' } : {} })
}

describe('requestJson', () => {
    const fetchMock = vi.fn<typeof fetch>()

    beforeEach(() => {
        fetchMock.mockReset()
        vi.stubGlobal('fetch', fetchMock)
    })

    afterEach(() => {
        vi.unstubAllGlobals()
    })

    it('claims a JSON body only when there is one, and lets caller headers win', async () => {
        fetchMock.mockImplementation(() => Promise.resolve(response(200, '{}')))
        await requestJson('/a')
        await requestJson('/b', { method: 'POST', body: '{}' })
        await requestJson('/c', { method: 'POST', body: 'raw', headers: { 'Content-Type': 'audio/webm' } })
        const headers = fetchMock.mock.calls.map(([, init]) => init?.headers)
        expect(headers[0]).toEqual({})
        expect(headers[1]).toEqual({ 'Content-Type': 'application/json' })
        expect(headers[2]).toEqual({ 'Content-Type': 'audio/webm' })
    })

    it('parses the body, and resolves undefined for an empty one', async () => {
        fetchMock.mockResolvedValueOnce(response(200, '{"hello":"world"}')).mockResolvedValueOnce(response(204, ''))
        await expect(requestJson('/x')).resolves.toEqual({ hello: 'world' })
        await expect(requestJson('/x', { method: 'DELETE' })).resolves.toBeUndefined()
    })

    it("raises ApiError with the server's message and refusal code", async () => {
        fetchMock.mockResolvedValueOnce(response(403, '{"message":"Plan limit reached","code":"score-limit"}'))
        const err = await requestJson('/scores', { method: 'POST', body: '{}' }).catch((e: unknown) => e)
        expect(err).toBeInstanceOf(ApiError)
        expect(err).toMatchObject({ name: 'ApiError', status: 403, message: 'Plan limit reached', code: 'score-limit' })
        expect((err as ApiError).isClientError).toBe(true)
        expect((err as ApiError).isScoreLimit).toBe(true)

        fetchMock.mockResolvedValueOnce(response(400, '{"error":"Bad corpus"}'))
        await expect(requestJson('/corpora')).rejects.toMatchObject({ message: 'Bad corpus', code: undefined })
    })

    it('keeps the status line for a non-JSON error body', async () => {
        fetchMock.mockResolvedValueOnce(new Response('<html>oops</html>', { status: 502, statusText: 'Bad Gateway' }))
        const err = await requestJson('/x').catch((e: unknown) => e)
        expect(err).toMatchObject({ status: 502, message: 'API error: 502 Bad Gateway' })
        expect((err as ApiError).isClientError).toBe(false)
    })

    it('raises NetworkError, keeping the cause, when the server is unreachable', async () => {
        const cause = new TypeError('Failed to fetch')
        fetchMock.mockRejectedValueOnce(cause)
        const err = await requestJson('/x').catch((e: unknown) => e)
        expect(err).toBeInstanceOf(NetworkError)
        expect(err).toMatchObject({ name: 'NetworkError', message: 'Could not reach the server', cause })
    })
})
