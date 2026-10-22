'use client'

import { Instrument } from '@mushee/notation/model'
import { useState } from 'react'

import { DialogPanel, PrimaryButton, TertiaryButton } from '@/components/ui'

import { InstrumentPicker } from '../InstrumentPicker'

interface ChangeInstrumentDialogProps {
    current: Instrument
    onCancel: () => void
    onConfirm: (instrument: Instrument) => void
}

/** Mounted only while open, so every opening starts from the score's current instrument. */
export function ChangeInstrumentDialog({ current, onCancel, onConfirm }: ChangeInstrumentDialogProps) {
    const [instrument, setInstrument] = useState<Instrument>(current)
    const dirty = instrument.id !== current.id

    return (
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
    )
}
