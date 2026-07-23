'use client'

import type { Score } from '@mushee/notation/model'
import { useCallback, useRef } from 'react'

import { useUpdateScore } from '@/lib/queries'

/** Debounced autosave: batches title/score changes into PATCHes, retrying on failure. */
export function useScoreAutosave(id: string) {
    const saveTimeoutRef = useRef<ReturnType<typeof setTimeout>>(undefined)
    const saveRetryRef = useRef<ReturnType<typeof setTimeout>>(undefined)
    const { mutate: saveScore } = useUpdateScore(id)

    const saveToApi = useCallback(
        (changes: { title?: string; score?: Score }) => {
            if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current)
            if (saveRetryRef.current) clearTimeout(saveRetryRef.current)
            saveTimeoutRef.current = setTimeout(() => {
                const body: {
                    title?: string
                    measures?: Record<string, unknown>
                    allMeasures?: unknown[]
                    partList?: Record<string, unknown>
                } = {}
                if (changes.title !== undefined) body.title = changes.title
                if (changes.score) {
                    const dirty = changes.score.flushDirty()
                    if (dirty?.measures) body.measures = dirty.measures
                    if (dirty?.allMeasures) body.allMeasures = dirty.allMeasures
                    if (dirty?.partList) body.partList = dirty.partList
                }
                if (body.title !== undefined || body.measures || body.allMeasures || body.partList) {
                    saveScore(body, {
                        onError: () => {
                            // flushDirty cleared this state before the request
                            // settled — put it back and retry, or these edits
                            // are silently gone until an unrelated later edit.
                            changes.score?.redirty(body)
                            saveRetryRef.current = setTimeout(() => saveToApi(changes), 10_000)
                        },
                    })
                }
            }, 2000)
        },
        [saveScore],
    )

    return saveToApi
}
