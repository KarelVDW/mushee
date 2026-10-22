'use client'

import type { Score, ScorePatch } from '@mushee/notation/model'
import { useCallback, useMemo, useRef, useState } from 'react'

import { useUpdateScore } from '@/lib/queries'

/** How long the autosave waits for the edits to settle before it sends them. */
export const AUTOSAVE_DEBOUNCE_MS = 2000
/** How long a failed save waits before it tries again by itself. */
export const AUTOSAVE_RETRY_MS = 10_000

/**
 * Where the score's changes stand: all on the server (`saved`), on their way — still inside
 * the debounce or in flight — (`saving`), or stuck after a failed save that keeps retrying
 * (`retrying`, until a save gets through).
 */
export type AutosaveState = 'saved' | 'saving' | 'retrying'

export interface AutosaveSnapshot {
    state: AutosaveState
    /** Bumped each time the changes land and nothing is left to send — the header says "Saved" for a moment. */
    landed: number
}

/**
 * The autosave's state as a tiny external store (`useSyncExternalStore`), so the one header
 * status that shows it re-renders on a save — not the whole editor page. Snapshots are
 * immutable; a change replaces the snapshot.
 */
export class AutosaveStatus {
    private snapshot: AutosaveSnapshot = { state: 'saved', landed: 0 }
    private readonly listeners = new Set<() => void>()

    subscribe = (listener: () => void): (() => void) => {
        this.listeners.add(listener)
        return () => this.listeners.delete(listener)
    }

    getSnapshot = (): AutosaveSnapshot => this.snapshot

    get state(): AutosaveState {
        return this.snapshot.state
    }

    /** Move to `state`; `landed` marks a save that just got everything onto the server. */
    set(state: AutosaveState, { landed = false }: { landed?: boolean } = {}): void {
        if (state === this.snapshot.state && !landed) return
        this.snapshot = { state, landed: this.snapshot.landed + (landed ? 1 : 0) }
        for (const listener of this.listeners) listener()
    }
}

export interface ScoreAutosave {
    /** Queue title / score changes; they go out together once edits settle for {@link AUTOSAVE_DEBOUNCE_MS}. */
    save: (changes: { title?: string; score?: Score }) => void
    /** Send whatever is waiting right now — the "Not saved yet — retrying" status's own retry. */
    retryNow: () => void
    status: AutosaveStatus
}

/**
 * Debounced autosave: batches title/score changes into PATCHes, retrying on failure.
 *
 * Changes accumulate across calls within the debounce window — a rename followed by a
 * score edit (or a recording take's stream of saves) must not drop the title. The newest
 * title replaces an older one; the newest Score instance replaces an older one (undo/redo
 * swap the instance, and a freshly rebuilt Score carries its whole document).
 *
 * The {@link AutosaveStatus} reads `saving` from the first unsaved change (the debounce
 * included) until the PATCH settles, so a recording take — which saves on every update —
 * stays `saving` until it has drained. A failure turns it `retrying` until a save gets
 * through; it never quietly goes back to looking saved.
 */
export function useScoreAutosave(id: string): ScoreAutosave {
    const saveTimeoutRef = useRef<ReturnType<typeof setTimeout>>(undefined)
    const saveRetryRef = useRef<ReturnType<typeof setTimeout>>(undefined)
    const pendingTitle = useRef<string | undefined>(undefined)
    const pendingScore = useRef<Score | undefined>(undefined)
    const inFlight = useRef(0)
    const failed = useRef(false)
    const [status] = useState(() => new AutosaveStatus())
    const { mutate: saveScore } = useUpdateScore(id)

    // No cleanup on unmount, deliberately: an edit made just before leaving the editor still
    // goes out once its debounce runs out.

    /** The status the bookkeeping adds up to right now. */
    const settle = useCallback(
        (landed = false) => {
            if (failed.current) status.set('retrying')
            else if (saveTimeoutRef.current !== undefined || inFlight.current > 0) status.set('saving')
            else status.set('saved', { landed })
        },
        [status],
    )

    const flush = useCallback(
        (retry: () => void) => {
            saveTimeoutRef.current = undefined
            const title = pendingTitle.current
            const score = pendingScore.current
            pendingTitle.current = undefined
            pendingScore.current = undefined
            const body: ScorePatch & { title?: string } = { ...(title !== undefined && { title }), ...score?.flushDirty() }
            if (Object.keys(body).length === 0) {
                settle()
                return
            }
            inFlight.current++
            settle()
            saveScore(body, {
                onSuccess: () => {
                    inFlight.current--
                    failed.current = false
                    settle(true)
                },
                onError: () => {
                    inFlight.current--
                    failed.current = true
                    // flushDirty cleared this state before the request
                    // settled — put it back and retry, or these edits
                    // are silently gone until an unrelated later edit.
                    // Anything queued since is newer and wins.
                    score?.redirty(body)
                    if (pendingTitle.current === undefined) pendingTitle.current = title
                    if (!pendingScore.current) pendingScore.current = score
                    clearTimeout(saveRetryRef.current)
                    saveRetryRef.current = setTimeout(retry, AUTOSAVE_RETRY_MS)
                    settle()
                },
            })
        },
        [saveScore, settle],
    )

    const save = useCallback(
        (changes: { title?: string; score?: Score }) => {
            if (changes.title !== undefined) pendingTitle.current = changes.title
            if (changes.score) pendingScore.current = changes.score
            clearTimeout(saveTimeoutRef.current)
            clearTimeout(saveRetryRef.current)
            saveTimeoutRef.current = setTimeout(() => flush(() => save({})), AUTOSAVE_DEBOUNCE_MS)
            settle()
        },
        [flush, settle],
    )

    const retryNow = useCallback(() => {
        clearTimeout(saveTimeoutRef.current)
        clearTimeout(saveRetryRef.current)
        flush(() => save({}))
    }, [flush, save])

    return useMemo(() => ({ save, retryNow, status }), [save, retryNow, status])
}
