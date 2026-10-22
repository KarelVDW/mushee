'use client'

import { useEffect, useRef, useState } from 'react'

import { DialogPanel, PrimaryButton, TertiaryButton, TextField } from '@/components/ui'
import type { ScoreMeta } from '@/lib/api'

interface RenameScoreDialogProps {
    score: ScoreMeta
    onCancel: () => void
    /** Called with the new title; never with a blank or unchanged one (the dialog just closes then). */
    onRename: (title: string) => void
}

/** Renames a score from its library row. Mount it only while open, so each opening starts from the current title. */
export function RenameScoreDialog({ score, onCancel, onRename }: RenameScoreDialogProps) {
    const [title, setTitle] = useState(score.title)
    const inputRef = useRef<HTMLInputElement>(null)

    useEffect(() => {
        // DialogPanel takes focus on mount; hand it to the field, its text selected for retyping.
        const timer = setTimeout(() => inputRef.current?.select(), 0)
        return () => clearTimeout(timer)
    }, [])

    // A blank title keeps the score's name, the way the editor's title field does.
    const submit = () => {
        const trimmed = title.trim()
        if (trimmed && trimmed !== score.title) onRename(trimmed)
        else onCancel()
    }

    return (
        <DialogPanel
            title="Rename score"
            width={440}
            onClose={onCancel}
            footer={
                <>
                    <TertiaryButton onClick={onCancel}>Cancel</TertiaryButton>
                    <PrimaryButton onClick={submit}>Rename</PrimaryButton>
                </>
            }>
            <div className="pb-3">
                <TextField
                    label="Title"
                    value={title}
                    onChange={setTitle}
                    placeholder={score.title}
                    inputRef={inputRef}
                    enterKeyHint="done"
                    onKeyDown={(e) => {
                        if (e.key === 'Enter') submit()
                    }}
                />
            </div>
        </DialogPanel>
    )
}
