import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, createElement, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }))
vi.mock('@/lib/api', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@/lib/api')>()),
    getOnboarding: vi.fn(),
    listScores: vi.fn(),
    updateScore: vi.fn(),
    patchOnboarding: vi.fn(),
}))

import { getOnboarding, listScores, NetworkError, type ScoreMeta, updateScore } from '@/lib/api'
import { useOnboarding, usePatchOnboarding, useRenameScore, useScores } from '@/lib/queries'

// React's act() refuses to run outside a test-aware environment.
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const ROW: ScoreMeta = { id: 's1', title: 'Evening Air', createdAt: '', updatedAt: '' }

let client: QueryClient
let unmount: (() => void) | undefined

beforeEach(() => {
    client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
})

afterEach(() => {
    unmount?.()
    unmount = undefined
    vi.clearAllMocks()
})

/** Runs `hook` inside a provider and hands back its latest result. */
function renderHook<T>(hook: () => T): { current: T } {
    const result = {} as { current: T }
    function Probe() {
        result.current = hook()
        return null
    }
    const host = document.createElement('div')
    const root = createRoot(host)
    act(() => root.render(createElement(QueryClientProvider, { client }, createElement(Probe) as ReactNode)))
    unmount = () => act(() => root.unmount())
    return result
}

async function settle() {
    await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0))
    })
}

describe('useOnboarding', () => {
    it('reads the stored answers, or null when nothing is stored yet', async () => {
        vi.mocked(getOnboarding).mockResolvedValueOnce({ instruments: ['Guitar'] })
        const answers = renderHook(() => useOnboarding())
        await vi.waitFor(() => expect(answers.current.data).toEqual({ instruments: ['Guitar'] }))
        unmount?.()

        client.clear()
        vi.mocked(getOnboarding).mockResolvedValueOnce(null)
        const none = renderHook(() => useOnboarding())
        await vi.waitFor(() => expect(none.current.data).toBeNull())
    })

    it('is refreshed when onboarding saves new answers', async () => {
        vi.mocked(getOnboarding).mockResolvedValue({ instruments: [] })
        const patch = renderHook(() => ({ answers: useOnboarding(), save: usePatchOnboarding() }))
        await settle()
        expect(getOnboarding).toHaveBeenCalledTimes(1)
        await act(async () => {
            await patch.current.save.mutateAsync({ instruments: ['Piano'] })
        })
        await vi.waitFor(() => expect(getOnboarding).toHaveBeenCalledTimes(2))
    })
})

describe('useRenameScore', () => {
    it('sends the title and shows it on every cached list row and an open editor at once', async () => {
        client.setQueryData(['scores', 'list', ''], [ROW])
        client.setQueryData(['scores', 'list', 'eve'], [ROW])
        client.setQueryData(['scores', 'detail', 's1'], { meta: ROW, document: {} })
        vi.mocked(updateScore).mockResolvedValueOnce({ ...ROW, title: 'Morning Air' })

        const rename = renderHook(() => useRenameScore())
        await act(async () => {
            await rename.current.mutateAsync({ id: 's1', title: 'Morning Air' })
        })

        expect(updateScore).toHaveBeenCalledWith('s1', { title: 'Morning Air' })
        expect(client.getQueryData<ScoreMeta[]>(['scores', 'list', ''])?.[0].title).toBe('Morning Air')
        expect(client.getQueryData<ScoreMeta[]>(['scores', 'list', 'eve'])?.[0].title).toBe('Morning Air')
        expect(client.getQueryData<{ meta: ScoreMeta }>(['scores', 'detail', 's1'])?.meta.title).toBe('Morning Air')
    })
})

describe('useScores', () => {
    it('keeps trying every ten seconds while the server is unreachable — and only then', async () => {
        vi.useFakeTimers()
        try {
            vi.mocked(listScores).mockRejectedValue(new NetworkError())
            renderHook(() => useScores())
            await act(async () => {
                await vi.advanceTimersByTimeAsync(0)
            })
            expect(listScores).toHaveBeenCalledTimes(1)
            await act(async () => {
                await vi.advanceTimersByTimeAsync(10_000)
            })
            expect(listScores).toHaveBeenCalledTimes(2)

            // Back online: no more polling.
            vi.mocked(listScores).mockResolvedValue([ROW])
            await act(async () => {
                await vi.advanceTimersByTimeAsync(10_000)
            })
            expect(listScores).toHaveBeenCalledTimes(3)
            await act(async () => {
                await vi.advanceTimersByTimeAsync(30_000)
            })
            expect(listScores).toHaveBeenCalledTimes(3)
        } finally {
            vi.useRealTimers()
        }
    })
})
