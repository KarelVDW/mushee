'use client'

import type { Score, ScorePatch } from '@mushee/notation/model'
import { useCallback, useRef } from 'react'

import { useUpdateScore } from '@/lib/queries'

/**
 * Debounced autosave: batches title/score changes into PATCHes, retrying on failure.
 *
 * Changes accumulate across calls within the debounce window — a rename followed by a
 * score edit (or a recording take's stream of saves) must not drop the title. The newest
 * title replaces an older one; the newest Score instance replaces an older one (undo/redo
 * swap the instance, and a freshly rebuilt Score carries its whole document).
 */
export function useScoreAutosave(id: string) {
    const saveTimeoutRef = useRef<ReturnType<typeof setTimeout>>(undefined)
    const saveRetryRef = useRef<ReturnType<typeof setTimeout>>(undefined)
    const pendingTitle = useRef<string | undefined>(undefined)
    const pendingScore = useRef<Score | undefined>(undefined)
    const { mutate: saveScore } = useUpdateScore(id)

    const saveToApi = useCallback(
        (changes: { title?: string; score?: Score }) => {
            if (changes.title !== undefined) pendingTitle.current = changes.title
            if (changes.score) pendingScore.current = changes.score
            if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current)
            if (saveRetryRef.current) clearTimeout(saveRetryRef.current)
            saveTimeoutRef.current = setTimeout(() => {
                const title = pendingTitle.current
                const score = pendingScore.current
                pendingTitle.current = undefined
                pendingScore.current = undefined
                const body: ScorePatch & { title?: string } = { ...(title !== undefined && { title }), ...score?.flushDirty() }
                if (Object.keys(body).length === 0) return
                saveScore(body, {
                    onError: () => {
                        // flushDirty cleared this state before the request
                        // settled — put it back and retry, or these edits
                        // are silently gone until an unrelated later edit.
                        // Anything queued since is newer and wins.
                        score?.redirty(body)
                        if (pendingTitle.current === undefined) pendingTitle.current = title
                        if (!pendingScore.current) pendingScore.current = score
                        saveRetryRef.current = setTimeout(() => saveToApi({}), 10_000)
                    },
                })
            }, 2000)
        },
        [saveScore],
    )

    return saveToApi
}
