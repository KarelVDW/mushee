'use client'

import { Instrument } from '@mushee/notation/model'
import { useEffect, useState } from 'react'

import { DialogPanel, DialogScrim, PrimaryButton, TertiaryButton } from '@/components/ui'

import { InstrumentPicker } from '../InstrumentPicker'

interface ChangeInstrumentDialogProps {
    open: boolean
    current: Instrument
    onCancel: () => void
    onConfirm: (instrument: Instrument) => void
}

export function ChangeInstrumentDialog({ open, current, onCancel, onConfirm }: ChangeInstrumentDialogProps) {
    const [instrument, setInstrument] = useState<Instrument>(current)

    useEffect(() => {
        if (!open) return
        setInstrument(current)
        const handleEsc = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onCancel()
        }
        window.addEventListener('keydown', handleEsc)
        return () => window.removeEventListener('keydown', handleEsc)
    }, [open, current, onCancel])

    if (!open) return null

    const dirty = instrument.id !== current.id

    return (
        <DialogScrim onDismiss={onCancel}>
            <DialogPanel
                title="Change instrument"
                subtitle={`Currently ${current.displayName}.`}
                onClose={onCancel}
                width={620}
                footer={
                    <>
                        <TertiaryButton onClick={onCancel}>Cancel</TertiaryButton>
                        <PrimaryButton emphasis="pop" disabled={!dirty} onClick={() => dirty && onConfirm(instrument)}>
                            Update
                        </PrimaryButton>
                    </>
                }>
                <div className="flex flex-col flex-1 min-h-0 pb-3">
                    <InstrumentPicker value={instrument} onChange={setInstrument} />
                </div>
            </DialogPanel>
        </DialogScrim>
    )
}
