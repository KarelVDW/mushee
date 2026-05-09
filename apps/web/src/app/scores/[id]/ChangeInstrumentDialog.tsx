'use client'

import { useEffect, useState } from 'react'

import { Instrument } from '@/model'

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
        <div
            className="fixed inset-0 z-[100] flex items-center justify-center bg-on-surface/40 backdrop-blur-sm p-[1.6rem]"
            onClick={onCancel}>
            <div
                onClick={(e) => e.stopPropagation()}
                role="dialog"
                aria-modal="true"
                aria-label="Change instrument"
                className="glass-panel rounded-xl tonal-layer-glow w-full max-w-[42rem] max-h-[90vh] flex flex-col">
                <header className="flex items-start justify-between px-[2rem] pt-[1.6rem] pb-[1.2rem]">
                    <div>
                        <h2 className="text-[2rem] font-black leading-none tracking-[-0.04em] uppercase text-on-surface">Change Instrument</h2>
                        <p className="text-[0.6rem] uppercase tracking-widest text-on-surface-variant font-bold mt-[0.4rem]">
                            Currently {current.displayName}
                        </p>
                    </div>
                    <button
                        type="button"
                        onClick={onCancel}
                        aria-label="Close"
                        className="text-on-surface hover:text-secondary transition-colors -mr-[0.4rem]">
                        <span className="material-symbols-outlined" style={{ fontSize: '20px' }}>close</span>
                    </button>
                </header>

                <div className="px-[2rem] flex flex-col flex-1 min-h-0">
                    <InstrumentPicker value={instrument} onChange={setInstrument} />
                </div>

                <footer className="flex justify-end items-center gap-[0.8rem] px-[2rem] py-[1.2rem] mt-[0.4rem]">
                    <button
                        type="button"
                        onClick={onCancel}
                        className="text-on-surface font-bold text-[0.6rem] uppercase tracking-widest px-[1rem] py-[0.5rem] hover:text-secondary transition-colors">
                        Cancel
                    </button>
                    <button
                        type="button"
                        onClick={() => dirty && onConfirm(instrument)}
                        disabled={!dirty}
                        className="bg-primary-container text-on-primary-container rounded-full px-[1.2rem] py-[0.5rem] font-bold text-[0.6rem] uppercase tracking-widest disabled:opacity-40 disabled:cursor-not-allowed shadow-[3px_3px_0px_0px_var(--color-secondary-container)] enabled:hover:shadow-[5px_5px_0px_0px_var(--color-secondary-container)] enabled:hover:-translate-y-[2px] transition-all">
                        Update
                    </button>
                </footer>
            </div>
        </div>
    )
}
