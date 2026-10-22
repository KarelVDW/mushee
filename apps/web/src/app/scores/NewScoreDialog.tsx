'use client'

import type { Instrument } from '@mushee/notation/model'
import { type ReactNode, useEffect, useRef, useState } from 'react'

import { DialogPanel, PrimaryButton, TertiaryButton, TextField } from '@/components/ui'

import { InstrumentPicker } from './InstrumentPicker'

/** The title a score gets when the field is left blank: warmer for the very first one. */
export function defaultScoreTitle(firstScore: boolean): string {
    return firstScore ? 'My first melody' : 'Untitled score'
}

interface NewScoreDialogProps {
    /** The dialog's heading — not the score's title, which the form collects. */
    title: string
    subtitle: string
    initialTitle?: string
    /**
     * The instrument the picker starts on. Until the user picks one, the dialog follows this
     * prop, so a default that resolves after opening (the onboarding answer) still lands.
     */
    initialInstrument: Instrument
    /** What a blank title saves as — and the field's placeholder. */
    titlePlaceholder?: string
    /** Shown between the title field and the instrument picker (e.g. what an import had to simplify). */
    notice?: ReactNode
    /**
     * `open` (default) shows the picker; `collapsed` shows one 'Instrument: Violin' row with
     * a 'Change' button that opens it — for an import, whose file already named the instrument.
     */
    picker?: 'open' | 'collapsed'
    /** The picker's one-line melody note for chordal instruments (C13); imports turn it off. */
    chordHint?: boolean
    onCancel: () => void
    onCreate: (title: string, instrument: Instrument) => void
}

/** Whether the device has a mouse or trackpad — on touch, focusing a field pops the keyboard over the picker. */
function hasFinePointer(): boolean {
    return typeof window !== 'undefined' && !!window.matchMedia?.('(pointer: fine)').matches
}

/**
 * The form every new score goes through: an optional title and the instrument. Create is
 * always enabled — a blank title saves as the placeholder. Mount it only while it is open,
 * so each opening starts from the initial values.
 */
export function NewScoreDialog({
    title: heading,
    subtitle,
    initialTitle = '',
    initialInstrument,
    titlePlaceholder = defaultScoreTitle(false),
    notice,
    picker = 'open',
    chordHint = true,
    onCancel,
    onCreate,
}: NewScoreDialogProps) {
    const [title, setTitle] = useState(initialTitle)
    const [picked, setPicked] = useState<Instrument | null>(null)
    const [pickerOpen, setPickerOpen] = useState(picker === 'open')
    const instrument = picked ?? initialInstrument
    const titleInputRef = useRef<HTMLInputElement>(null)

    useEffect(() => {
        // DialogPanel takes focus on mount; on a mouse, steal it back to the title field right
        // after, so typing can start at once. On touch the keyboard would cover the picker.
        if (!hasFinePointer()) return
        const focusTimer = setTimeout(() => titleInputRef.current?.focus(), 0)
        return () => clearTimeout(focusTimer)
    }, [])

    const submit = () => onCreate(title.trim() || titlePlaceholder, instrument)

    return (
        <DialogPanel
            title={heading}
            subtitle={subtitle}
            onClose={onCancel}
            width={620}
            footer={
                <>
                    <TertiaryButton onClick={onCancel}>Cancel</TertiaryButton>
                    <PrimaryButton onClick={submit}>Create score</PrimaryButton>
                </>
            }>
            <div className="flex flex-col gap-4 flex-1 min-h-0 pb-3">
                <TextField
                    label="Title"
                    value={title}
                    onChange={setTitle}
                    placeholder={titlePlaceholder}
                    hint="Optional — you can rename it any time."
                    inputRef={titleInputRef}
                    enterKeyHint="done"
                    onKeyDown={(e) => {
                        if (e.key === 'Enter') submit()
                    }}
                />
                {notice}
                {pickerOpen ? (
                    <div className="flex-1 min-h-0 flex flex-col">
                        <InstrumentPicker
                            value={instrument}
                            onChange={setPicked}
                            chordHint={chordHint}
                            autoFocusSearch={picker === 'collapsed'}
                        />
                    </div>
                ) : (
                    <div className="flex items-center justify-between gap-3 bg-surface-container-low rounded-md pl-3.5 pr-3 py-1.5">
                        <span className="font-body font-normal text-[14px] leading-normal text-on-surface">
                            Instrument: {instrument.displayName}
                        </span>
                        <TertiaryButton onClick={() => setPickerOpen(true)}>Change</TertiaryButton>
                    </div>
                )}
            </div>
        </DialogPanel>
    )
}
