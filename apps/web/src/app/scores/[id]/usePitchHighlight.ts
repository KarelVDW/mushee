'use client'

import type { ScoreHighlight } from '@mushee/notation/components'
import { useCallback, useEffect, useRef, useState } from 'react'

import type { PitchScope } from '@/components/editor/pitchScope'

import type { ScoreManipulator } from './ScoreManipulator'

/** How long the flash over a just-rewritten range stays before it clears. */
const FLASH_MS = 900

/**
 * Transient magenta emphasis on the canvas: a pulse over the open transpose popover's target
 * range (`aim`, the popover's onScopeChange), replaced by a fading flash the moment an edit
 * lands on a range — a pitch operation, or the bars a recording just added (the manipulator's
 * onRangeFlash hook, registered here; its flashRange triggers it from outside). The flash
 * fades 0.24 → 0 over FLASH_MS; under reduced motion HighlightLayer rests it as a static wash,
 * which this hook clears after the same FLASH_MS.
 */
export function usePitchHighlight(manipulator: ScoreManipulator): {
    highlight: ScoreHighlight | null
    aim: (scope: PitchScope | null) => void
} {
    const [highlight, setHighlight] = useState<ScoreHighlight | null>(null)
    const highlightSeq = useRef(0)
    const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

    // The open transpose popover aims a gentle pulse at its target range; closing clears it
    // — but never a flash that an Apply just set (the popover closes right after applying).
    const aim = useCallback(
        (scope: PitchScope | null) => {
            setHighlight((current) => {
                if (scope === null) return current?.kind === 'pulse' ? null : current
                return { kind: 'pulse', notes: scope === 'selection' ? manipulator.selectedNotes : 'all', id: ++highlightSeq.current }
            })
        },
        [manipulator],
    )

    // Flash the range an edit just landed on (transpose apply / minimize accidentals / a take's bars).
    useEffect(() => {
        manipulator.onRangeFlash = (notes) => {
            if (flashTimer.current) clearTimeout(flashTimer.current)
            setHighlight({ kind: 'flash', notes, id: ++highlightSeq.current })
            flashTimer.current = setTimeout(() => setHighlight(null), FLASH_MS)
        }
        return () => {
            manipulator.onRangeFlash = undefined
            if (flashTimer.current) clearTimeout(flashTimer.current)
        }
    }, [manipulator])

    return { highlight, aim }
}
