import type { Score } from '@mushee/notation/model'
import { makeScore, pitched } from '@mushee/notation/testing'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useScoreAutosave } from '@/app/scores/[id]/useScoreAutosave'

// React's act() refuses to run outside a test-aware environment.
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

type PatchBody = Record<string, unknown>
type MutateOptions = { onError?: (error: unknown) => void }

// The PATCH mutation, captured: each call's body, and its options so a test can fail it.
const { mutate } = vi.hoisted(() => ({ mutate: vi.fn<(body: PatchBody, options?: MutateOptions) => void>() }))
vi.mock('@/lib/queries', () => ({ useUpdateScore: () => ({ mutate }) }))

const DEBOUNCE_MS = 2000
const RETRY_MS = 10_000

/** A two-measure score whose measure `index` carries an unsaved edit. */
function editedScore(index = 1): Score {
    const score = makeScore(2)
    score.flushDirty() // the fresh score's own construction is not an edit
    const measure = score.measures[index]
    score.replace(measure.notes.slice(0, 1), [pitched('C', 5)])
    return score
}

const body = (call: number): PatchBody => mutate.mock.calls[call][0]
/** Settle call `call`'s PATCH as failed, the way React Query reports it. */
const fail = (call: number) => act(() => mutate.mock.calls[call][1]?.onError?.(new Error('offline')))
const advance = (ms: number) =>
    act(() => {
        vi.advanceTimersByTime(ms)
    })

describe('useScoreAutosave', () => {
    let container: HTMLElement
    let root: Root
    let saveToApi: ReturnType<typeof useScoreAutosave>

    function Harness() {
        saveToApi = useScoreAutosave('score-1')
        return null
    }

    beforeEach(() => {
        vi.useFakeTimers()
        mutate.mockReset()
        container = document.createElement('div')
        document.body.appendChild(container)
        root = createRoot(container)
        act(() => root.render(createElement(Harness)))
    })

    afterEach(() => {
        act(() => root.unmount())
        container.remove()
        vi.useRealTimers()
    })

    it('sends a rename and a following edit inside the window as one PATCH', () => {
        const score = editedScore()
        saveToApi({ title: 'Renamed' })
        advance(DEBOUNCE_MS / 2)
        saveToApi({ score })
        advance(DEBOUNCE_MS - 1)
        expect(mutate).not.toHaveBeenCalled()
        advance(1)

        expect(mutate).toHaveBeenCalledTimes(1)
        expect(body(0).title).toBe('Renamed')
        expect(body(0).measures ?? body(0).allMeasures).toBeTruthy()
    })

    it('sends nothing when nothing changed', () => {
        saveToApi({})
        advance(DEBOUNCE_MS)
        expect(mutate).not.toHaveBeenCalled()
    })

    it('re-sends the same title and the edits on retry after a failed PATCH', () => {
        const score = editedScore()
        saveToApi({ title: 'Renamed', score })
        advance(DEBOUNCE_MS)
        const sent = body(0)
        fail(0)

        // The retry waits out its own delay, then the debounce.
        advance(RETRY_MS)
        expect(mutate).toHaveBeenCalledTimes(1)
        advance(DEBOUNCE_MS)
        expect(mutate).toHaveBeenCalledTimes(2)
        expect(body(1)).toEqual(sent)
    })

    it('lets a title typed while the failed PATCH was in flight win, and still re-sends the edits', () => {
        const score = editedScore()
        saveToApi({ title: 'First', score })
        advance(DEBOUNCE_MS)
        const sent = body(0)
        saveToApi({ title: 'Second' })
        fail(0)

        advance(DEBOUNCE_MS)
        expect(mutate).toHaveBeenCalledTimes(2)
        expect(body(1)).toEqual({ ...sent, title: 'Second' })
        // The scheduled retry finds nothing left to send.
        advance(RETRY_MS + DEBOUNCE_MS)
        expect(mutate).toHaveBeenCalledTimes(2)
    })

    it('keeps a newer score instance queued since the failure (an undo/redo swap) over the failed one', () => {
        const failed = editedScore()
        saveToApi({ score: failed })
        advance(DEBOUNCE_MS)
        // A different measure, so the two instances' patches can't be mistaken for each other.
        const newer = editedScore(0)
        const newerPatch = editedScore(0).flushDirty()
        expect(newerPatch).not.toEqual(body(0))
        saveToApi({ score: newer })
        fail(0)

        advance(DEBOUNCE_MS)
        expect(mutate).toHaveBeenCalledTimes(2)
        expect(body(1)).toEqual(newerPatch)
    })
})
