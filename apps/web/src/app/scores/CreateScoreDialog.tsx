'use client'

import { useEffect, useRef, useState } from 'react'

import { DialogPanel, DialogScrim, PrimaryButton, TertiaryButton, TextField } from '@/components/ui'
import { Instrument } from '@/model'

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
        const focusTimer = setTimeout(() => titleInputRef.current?.focus(), 0)
        const handleEsc = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onCancel()
        }
        window.addEventListener('keydown', handleEsc)
        return () => {
            clearTimeout(focusTimer)
            window.removeEventListener('keydown', handleEsc)
        }
    }, [open, onCancel])

    if (!open) return null

    const trimmed = title.trim()
    const canSubmit = trimmed.length > 0

    const submit = () => {
        if (!canSubmit) return
        onCreate(trimmed, instrument)
    }

    return (
        <DialogScrim onDismiss={onCancel}>
            <DialogPanel
                title="New score"
                eyebrow="Give it a name and pick a lead instrument."
                onClose={onCancel}
                width={620}
                footer={
                    <>
                        <TertiaryButton onClick={onCancel}>Cancel</TertiaryButton>
                        <PrimaryButton emphasis="pop" disabled={!canSubmit} onClick={submit}>
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
                        autoFocus
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
        </DialogScrim>
    )
}
