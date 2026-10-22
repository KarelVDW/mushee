import { afterEach, describe, expect, it, vi } from 'vitest'

const { showToast } = vi.hoisted(() => ({ showToast: vi.fn() }))
vi.mock('../src/Toast', () => ({ showToast }))

import { ApiError, NetworkError } from '../src/http'
import { createQueryClient } from '../src/queryClient'

describe('createQueryClient', () => {
    afterEach(() => {
        showToast.mockReset()
    })

    it('retries only transient failures, at most twice', () => {
        const retry = createQueryClient().getDefaultOptions().queries?.retry as (failureCount: number, error: unknown) => boolean
        expect(retry(0, new ApiError(404, 'Not found'))).toBe(false)
        expect(retry(0, new ApiError(503, 'Unavailable'))).toBe(true)
        expect(retry(0, new NetworkError())).toBe(true)
        expect(retry(2, new NetworkError())).toBe(false)
    })

    it('toasts a failed mutation unless its meta opts out', async () => {
        const client = createQueryClient()
        const run = async (error: Error, meta?: { errorMessage?: string; silentError?: boolean }) => {
            const mutation = client.getMutationCache().build(client, { mutationFn: () => Promise.reject(error), meta, retry: false })
            await mutation.execute(undefined).catch(() => {})
        }

        await run(new NetworkError())
        await run(new ApiError(409, 'Title taken'))
        await run(new Error('boom'))
        await run(new ApiError(500, 'Server'), { errorMessage: 'Could not delete the score.' })
        await run(new ApiError(400, 'Inline'), { silentError: true })

        expect(showToast.mock.calls.map(([message]) => message as string)).toEqual([
            "Can't reach the server — check your connection.",
            'Title taken',
            'Something went wrong. Please try again.',
            'Could not delete the score.',
        ])
    })
})
