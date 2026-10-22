'use client'

import { DialogPanel, PrimaryButton, TertiaryButton } from '@/components/ui'
import type { ScoreMeta } from '@/lib/api'

interface DeleteScoreDialogProps {
    score: ScoreMeta
    onCancel: () => void
    onConfirm: () => void
}

/** Confirms deleting a score from the library — there is no undo, so it asks first. */
export function DeleteScoreDialog({ score, onCancel, onConfirm }: DeleteScoreDialogProps) {
    return (
        <DialogPanel
            title="Delete this score?"
            subtitle={`“${score.title}” will be gone for good — there's no undo.`}
            width={440}
            onClose={onCancel}
            footer={
                <>
                    <TertiaryButton onClick={onCancel}>Keep it</TertiaryButton>
                    <PrimaryButton danger onClick={onConfirm}>
                        Delete score
                    </PrimaryButton>
                </>
            }
        />
    )
}
