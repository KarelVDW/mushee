import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, createElement, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { push, showToast } = vi.hoisted(() => ({ push: vi.fn(), showToast: vi.fn() }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }))
vi.mock('@mushee/ui', async (importOriginal) => ({ ...(await importOriginal<typeof import('@mushee/ui')>()), showToast }))
vi.mock('@/lib/api', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@/lib/api')>()),
    createScore: vi.fn(),
    getOnboarding: vi.fn(),
    listScores: vi.fn(),
    updateScore: vi.fn(),
    patchOnboarding: vi.fn(),
}))

import { Instrument } from '@mushee/notation/model'

import { ApiError, createScore, getOnboarding, listScores, NetworkError, type ScoreMeta, updateScore } from '@/lib/api'
import { useOnboarding, usePatchOnboarding, useRenameScore, useScores, useStartFirstMelody } from '@/lib/queries'

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

describe('useStartFirstMelody', () => {
    const CREATED: ScoreMeta = { id: 'first-1', title: 'My first melody', createdAt: '', updatedAt: '' }
    /** The score that was sent, as text: its part names the instrument it starts on. */
    const sentScore = () => JSON.stringify(vi.mocked(createScore).mock.calls[0]?.[1])

    it('makes "My first melody" on the first pitched onboarding pick and opens it ready to record', async () => {
        vi.mocked(getOnboarding).mockResolvedValue({ instruments: ['Woodblock', 'Not an instrument', 'Violin', 'Piano'] })
        vi.mocked(createScore).mockResolvedValue(CREATED)
        const melody = renderHook(() => useStartFirstMelody())
        await settle()
        act(() => melody.current.start())
        await vi.waitFor(() => expect(push).toHaveBeenCalledWith('/scores/first-1?first=1'))
        expect(vi.mocked(createScore).mock.calls[0]?.[0]).toBe('My first melody')
        expect(sentScore()).toContain('Violin')
        expect(sentScore()).not.toContain('Woodblock')
        // Still "Getting it ready…" while the editor opens.
        expect(melody.current.creating).toBe(true)
    })

    it('starts on the instrument it is handed, and on the voice when there is no pick at all', async () => {
        vi.mocked(getOnboarding).mockResolvedValue({ instruments: ['Violin'] })
        vi.mocked(createScore).mockResolvedValue(CREATED)
        const handed = renderHook(() => useStartFirstMelody())
        await settle()
        act(() => handed.current.start(Instrument.Flute))
        await vi.waitFor(() => expect(push).toHaveBeenCalled())
        expect(sentScore()).toContain('Flute')
        unmount?.()

        client.clear()
        vi.mocked(createScore).mockClear()
        vi.mocked(getOnboarding).mockResolvedValue(null)
        const none = renderHook(() => useStartFirstMelody())
        await settle()
        act(() => none.current.start())
        await vi.waitFor(() => expect(createScore).toHaveBeenCalled())
        expect(sentScore()).toContain(Instrument.VoiceLead.displayName)
    })

    it('sends a full library to the library, where the limit dialog explains — no toast', async () => {
        vi.mocked(getOnboarding).mockResolvedValue(null)
        vi.mocked(createScore).mockRejectedValue(new ApiError(403, 'Score limit reached', 'score-limit'))
        const melody = renderHook(() => useStartFirstMelody())
        act(() => melody.current.start())
        await vi.waitFor(() => expect(push).toHaveBeenCalledWith('/scores?new=1'))
        expect(showToast).not.toHaveBeenCalled()
        expect(melody.current.creating).toBe(false)
    })

    it('says so in a toast when the score could not be made', async () => {
        vi.mocked(getOnboarding).mockResolvedValue(null)
        vi.mocked(createScore).mockRejectedValue(new NetworkError())
        const melody = renderHook(() => useStartFirstMelody())
        act(() => melody.current.start())
        await vi.waitFor(() => expect(showToast).toHaveBeenCalledWith("Couldn't create your score. Please try again."))
        expect(push).not.toHaveBeenCalled()
    })
})
