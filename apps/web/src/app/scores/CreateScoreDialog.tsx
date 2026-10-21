'use client'

import { Instrument } from '@mushee/notation/model'
import { useEffect, useRef, useState } from 'react'

import { DialogPanel, PrimaryButton, TertiaryButton, TextField } from '@/components/ui'

import { InstrumentPicker } from './InstrumentPicker'

interface CreateScoreDialogProps {
    open: boolean
    onCancel: () => void
    onCreate: (title: string, instrument: Instrument) => void
}

export function CreateScoreDialog({ open, onCancel, onCreate }: CreateScoreDialogProps) {
    const [title, setTitle] = useState('')
    const [instrument, setInstrument] = useState<Instrument>(Instrument.Piano)
    const titleInputRef = useRef<HTMLInputElement>(null)

    useEffect(() => {
        if (!open) {
            setTitle('')
            setInstrument(Instrument.Piano)
            return
        }
        // DialogPanel takes focus on mount; steal it back to the title field right
        // after, so typing can start immediately. (Escape is handled by the panel.)
        const focusTimer = setTimeout(() => titleInputRef.current?.focus(), 0)
        return () => clearTimeout(focusTimer)
    }, [open])

    if (!open) return null

    const trimmed = title.trim()
    const canSubmit = trimmed.length > 0

    const submit = () => {
        if (!canSubmit) return
        onCreate(trimmed, instrument)
    }

    return (
        <DialogPanel
            title="New score"
            subtitle="Give it a name and pick a lead instrument."
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
                <div className="flex-1 min-h-0 flex flex-col">
                    <InstrumentPicker value={instrument} onChange={setInstrument} />
                </div>
            </div>
        </DialogPanel>
    )
}
