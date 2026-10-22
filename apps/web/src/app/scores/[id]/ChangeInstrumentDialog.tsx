'use client'

import { Instrument } from '@mushee/notation/model'
import { useState } from 'react'

import { DialogPanel, PrimaryButton, TertiaryButton, Tooltip } from '@/components/ui'

import { InstrumentPicker } from '../InstrumentPicker'

interface ChangeInstrumentDialogProps {
    current: Instrument
    onCancel: () => void
    onConfirm: (instrument: Instrument) => void
}

/**
 * Mounted only while open, so every opening starts from the score's current instrument. The
 * shared picker (popular tiles, 'All instruments', the chord line for a chordal pick) without
 * its 'Instrument · X' readout — the picked tile and the confirm already say it — and without
 * its new-score intro: the subtitle is this dialog's one explanation. The flat
 * confirm names the pick ('Use Violin') and, until a different instrument is picked, says why
 * it waits.
 */
export function ChangeInstrumentDialog({ current, onCancel, onConfirm }: ChangeInstrumentDialogProps) {
    const [instrument, setInstrument] = useState<Instrument>(current)
    const dirty = instrument.id !== current.id

    return (
        <DialogPanel
            title="Change instrument"
            subtitle="Changes the playback sound and how the notes are written for it. Your melody stays the same."
            onClose={onCancel}
            width={620}
            footer={
                <>
                    <TertiaryButton onClick={onCancel}>Cancel</TertiaryButton>
                    <Tooltip reason={dirty ? undefined : 'Pick a different instrument'}>
                        <PrimaryButton disabled={!dirty} onClick={() => dirty && onConfirm(instrument)}>
                            Use {instrument.displayName}
                        </PrimaryButton>
                    </Tooltip>
                </>
            }>
            <div className="flex flex-col flex-1 min-h-0 pb-3">
                <InstrumentPicker value={instrument} onChange={setInstrument} showCurrentEyebrow={false} showIntro={false} />
            </div>
        </DialogPanel>
    )
}
