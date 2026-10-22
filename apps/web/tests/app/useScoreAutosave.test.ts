import type { Score } from '@mushee/notation/model'
import { makeScore, pitched } from '@mushee/notation/testing'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { type AutosaveStatus, useScoreAutosave } from '@/app/scores/[id]/useScoreAutosave'

// React's act() refuses to run outside a test-aware environment.
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

type PatchBody = Record<string, unknown>
type MutateOptions = { onSuccess?: () => void; onError?: (error: unknown) => void }

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
/** Settle call `call`'s PATCH as saved. */
const succeed = (call: number) => act(() => mutate.mock.calls[call][1]?.onSuccess?.())
const advance = (ms: number) =>
    act(() => {
        vi.advanceTimersByTime(ms)
    })

describe('useScoreAutosave', () => {
    let container: HTMLElement
    let root: Root
    let saveToApi: ReturnType<typeof useScoreAutosave>['save']
    let retryNow: () => void
    let status: AutosaveStatus

    function Harness() {
        const autosave = useScoreAutosave('score-1')
        saveToApi = autosave.save
        retryNow = autosave.retryNow
        status = autosave.status
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

    describe('status', () => {
        it('reads saving from the first change, through the debounce and the request, then saved', () => {
            expect(status.getSnapshot()).toEqual({ state: 'saved', landed: 0 })
            saveToApi({ title: 'Renamed' })
            expect(status.state).toBe('saving')
            advance(DEBOUNCE_MS)
            expect(mutate).toHaveBeenCalledTimes(1)
            expect(status.state).toBe('saving')
            succeed(0)
            expect(status.getSnapshot()).toEqual({ state: 'saved', landed: 1 })
        })

        it('stays saving while newer changes wait, and lands once they are sent', () => {
            saveToApi({ title: 'First' })
            advance(DEBOUNCE_MS)
            saveToApi({ title: 'Second' })
            succeed(0)
            expect(status.state).toBe('saving')
            advance(DEBOUNCE_MS)
            succeed(1)
            expect(status.getSnapshot()).toEqual({ state: 'saved', landed: 1 })
        })

        it('settles back to saved without a landing when there was nothing to send', () => {
            saveToApi({})
            expect(status.state).toBe('saving')
            advance(DEBOUNCE_MS)
            expect(status.getSnapshot()).toEqual({ state: 'saved', landed: 0 })
        })

        it('turns retrying on a failure and stays so through new edits until a save gets through', () => {
            saveToApi({ title: 'Renamed' })
            advance(DEBOUNCE_MS)
            fail(0)
            expect(status.state).toBe('retrying')
            saveToApi({ score: editedScore() })
            expect(status.state).toBe('retrying')
            advance(DEBOUNCE_MS)
            expect(status.state).toBe('retrying')
            succeed(1)
            expect(status.getSnapshot()).toEqual({ state: 'saved', landed: 1 })
        })

        it('retries now on request, without waiting out the retry delay or the debounce', () => {
            saveToApi({ title: 'Renamed' })
            advance(DEBOUNCE_MS)
            const sent = body(0)
            fail(0)
            act(() => retryNow())
            expect(mutate).toHaveBeenCalledTimes(2)
            expect(body(1)).toEqual(sent)
            succeed(1)
            expect(status.state).toBe('saved')
            // The scheduled retry was called off: nothing more goes out.
            advance(RETRY_MS + DEBOUNCE_MS)
            expect(mutate).toHaveBeenCalledTimes(2)
        })

        it('notifies subscribers on a change and not on a repeat', () => {
            const listener = vi.fn()
            const unsubscribe = status.subscribe(listener)
            saveToApi({ title: 'a' })
            saveToApi({ title: 'b' })
            expect(listener).toHaveBeenCalledTimes(1)
            unsubscribe()
            advance(DEBOUNCE_MS)
            expect(listener).toHaveBeenCalledTimes(1)
        })
    })
})
