'use client'

import type { Instrument } from '@mushee/notation/model'
import { type ReactNode, useEffect, useRef, useState } from 'react'

import { DialogPanel, PrimaryButton, TertiaryButton, TextField } from '@/components/ui'

import { InstrumentPicker } from './InstrumentPicker'

interface NewScoreDialogProps {
    /** The dialog's heading — not the score's title, which the form collects. */
    title: string
    subtitle: string
    initialTitle?: string
    initialInstrument: Instrument
    /** Shown between the title field and the instrument picker (e.g. what an import had to adjust). */
    notice?: ReactNode
    onCancel: () => void
    onCreate: (title: string, instrument: Instrument) => void
}

/**
 * The form every new score goes through: a title and a lead instrument. Mount it
 * only while it is open, so each opening starts from the initial values.
 */
export function NewScoreDialog({
    title: heading,
    subtitle,
    initialTitle = '',
    initialInstrument,
    notice,
    onCancel,
    onCreate,
}: NewScoreDialogProps) {
    const [title, setTitle] = useState(initialTitle)
    const [instrument, setInstrument] = useState<Instrument>(initialInstrument)
    const titleInputRef = useRef<HTMLInputElement>(null)

    useEffect(() => {
        // DialogPanel takes focus on mount; steal it back to the title field right
        // after, so typing can start immediately. (Escape is handled by the panel.)
        const focusTimer = setTimeout(() => titleInputRef.current?.focus(), 0)
        return () => clearTimeout(focusTimer)
    }, [])

    const trimmed = title.trim()
    const canSubmit = trimmed.length > 0

    const submit = () => {
        if (!canSubmit) return
        onCreate(trimmed, instrument)
    }

    return (
        <DialogPanel
            title={heading}
            subtitle={subtitle}
            onClose={onCancel}
            width={620}
            footer={
                <>
                    <TertiaryButton onClick={onCancel}>Cancel</TertiaryButton>
                    <PrimaryButton disabled={!canSubmit} onClick={submit}>
                        Create score
                    </PrimaryButton>
                </>
            }>
            <div className="flex flex-col gap-4 flex-1 min-h-0 pb-3">
                <TextField
                    label="Title"
                    value={title}
                    onChange={setTitle}
                    placeholder="Untitled composition"
                    inputRef={titleInputRef}
                    onKeyDown={(e) => {
                        if (e.key === 'Enter' && canSubmit) submit()
                    }}
                />
                {notice}
                <div className="flex-1 min-h-0 flex flex-col">
                    <InstrumentPicker value={instrument} onChange={setInstrument} />
                </div>
            </div>
        </DialogPanel>
    )
}
