'use client'

import { TertiaryButton } from '@/components/ui'

interface InlineConfirmProps {
    /** The question, saying what the action costs: 'Delete this recording? Your notes stay.' */
    question: string
    /** The destructive answer ('Delete', 'Turn off'), drawn as the danger text button. */
    confirmLabel: string
    /** The way back ('Keep', 'Keep it on'). */
    keepLabel: string
    onConfirm: () => void
    onKeep: () => void
    /**
     * Extra data-* attributes for the keep button's wrapper, for a caller that finds it by its
     * own hook (ShareMenu's `data-share-focus`). The wrapper always carries `data-keep`.
     */
    keepData?: Record<`data-${string}`, string>
}

/**
 * The two-step confirm a row or panel swaps in for a destructive action: a 13px question, then
 * the danger answer and the way back, 12px apart so neither is hit for the other. On a narrow
 * panel the answers wrap under the question rather than squeezing it. The caller moves focus
 * onto the keep button (`[data-keep] button`) when it opens.
 */
export function InlineConfirm({ question, confirmLabel, keepLabel, onConfirm, onKeep, keepData }: InlineConfirmProps) {
    return (
        <div className="flex flex-1 min-w-0 flex-wrap items-center justify-between gap-x-3 gap-y-1">
            <span className="font-body font-medium text-[13px] leading-snug text-on-surface">{question}</span>
            <span className="inline-flex items-center gap-3">
                <TertiaryButton danger onClick={onConfirm}>
                    {confirmLabel}
                </TertiaryButton>
                <span data-keep {...keepData} className="contents">
                    <TertiaryButton onClick={onKeep}>{keepLabel}</TertiaryButton>
                </span>
            </span>
        </div>
    )
}
