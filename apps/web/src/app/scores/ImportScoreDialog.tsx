'use client'

import type { Instrument, Score } from '@mushee/notation/model'
import { useEffect, useRef, useState } from 'react'

import { DialogPanel, DialogScrim, Eyebrow, Icon, PrimaryButton, TertiaryButton, TextField } from '@/components/ui'
import type { ImportedScoreFile } from '@/lib/ScoreFileImporter'

import { InstrumentPicker } from './InstrumentPicker'

interface ImportScoreDialogProps {
    imported: ImportedScoreFile
    onCancel: () => void
    onCreate: (title: string, score: Score) => void
}

/**
 * The last step of importing a file: the score has been read, and the user
 * confirms its title and lead instrument — and sees what the import had to
 * simplify — before the score is created.
 */
export function ImportScoreDialog({ imported, onCancel, onCreate }: ImportScoreDialogProps) {
    const [title, setTitle] = useState(imported.title)
    const [instrument, setInstrument] = useState<Instrument>(imported.score.instrument)
    const titleInputRef = useRef<HTMLInputElement>(null)

    useEffect(() => {
        // DialogScrim focuses its panel on mount; move focus on to the title field right after.
        const focusTimer = setTimeout(() => titleInputRef.current?.focus(), 0)
        return () => clearTimeout(focusTimer)
    }, [])

    const trimmed = title.trim()
    const canSubmit = trimmed.length > 0
    const { score, warnings } = imported
    const first = score.firstMeasure
    const bars = score.measures.length
    const summary = [`${bars} ${bars === 1 ? 'bar' : 'bars'}`, first && `${first.timeSignature.beatAmount}/${first.timeSignature.beatType}`]
        .filter(Boolean)
        .join(' · ')

    const submit = () => {
        if (!canSubmit) return
        // Switching instrument keeps the sounding music: the model rewrites written pitch for the new transposition.
        if (instrument !== score.instrument) score.setInstrument(instrument)
        onCreate(trimmed, score)
    }

    return (
        <DialogScrim onDismiss={onCancel}>
            <DialogPanel
                title="Import score"
                subtitle={`${summary} read from the file. Check the title and lead instrument, then create the score.`}
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
                    {warnings.length > 0 && (
                        <div
                            role="status"
                            aria-label="Adjusted on import"
                            className="bg-surface-container-low rounded-md px-3.5 py-3 flex gap-3">
                            <span className="text-on-surface-variant shrink-0 pt-0.5">
                                <Icon name="info" size={16} />
                            </span>
                            <div className="flex flex-col gap-1.5 min-w-0">
                                <Eyebrow>Adjusted on import</Eyebrow>
                                <ul className="m-0 p-0 list-none flex flex-col gap-1">
                                    {warnings.map((warning) => (
                                        <li
                                            key={warning}
                                            className="font-body font-normal text-[13px] leading-normal text-on-surface-variant">
                                            {warning}
                                        </li>
                                    ))}
                                </ul>
                            </div>
                        </div>
                    )}
                    <div className="flex-1 min-h-0 flex flex-col">
                        <InstrumentPicker value={instrument} onChange={setInstrument} />
                    </div>
                </div>
            </DialogPanel>
        </DialogScrim>
    )
}
