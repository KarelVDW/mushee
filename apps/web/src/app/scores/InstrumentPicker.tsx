'use client'

import { useMemo, useState } from 'react'

import { Instrument } from '@/model'

interface InstrumentPickerProps {
    value: Instrument
    onChange: (instrument: Instrument) => void
}

/**
 * Search input + scrollable chip grid over `Instrument.selectable()`. Shared
 * between the create-score dialog and the change-instrument dialog. The chip
 * styling follows DESIGN.md §5: `secondary_container` (Magenta) for the active
 * state, no borders — contrast against `surface_container` defines the shape.
 */
export function InstrumentPicker({ value, onChange }: InstrumentPickerProps) {
    const [search, setSearch] = useState('')

    const filtered = useMemo(() => {
        const q = search.trim().toLowerCase()
        const all = Instrument.selectable()
        if (!q) return all
        return all.filter((i) => i.displayName.toLowerCase().includes(q))
    }, [search])

    return (
        <div className="flex flex-col flex-1 min-h-0">
            <div className="flex items-baseline justify-between mb-[0.4rem]">
                <label className="text-[0.6rem] uppercase tracking-widest text-outline-variant font-bold">Instrument</label>
                <span className="text-[0.6rem] uppercase tracking-widest text-secondary font-bold">{value.displayName}</span>
            </div>
            <div className="input-field-container bg-surface-container-low rounded relative mb-[0.8rem]">
                <span
                    className="material-symbols-outlined text-outline absolute left-[0.6rem] top-1/2 -translate-y-1/2 pointer-events-none"
                    style={{ fontSize: '18px' }}>
                    search
                </span>
                <input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Filter instruments..."
                    type="text"
                    className="input-field bg-transparent text-on-surface text-[0.85rem] py-[0.5rem] pl-[2rem] pr-[0.8rem] w-full placeholder-on-surface-variant/50"
                />
            </div>
            <div className="overflow-y-auto flex flex-wrap content-start gap-[0.4rem] pb-[0.4rem] pr-[0.4rem] flex-1 min-h-[10rem]">
                {filtered.map((i) => {
                    const active = i.id === value.id
                    return (
                        <button
                            type="button"
                            key={i.id}
                            onClick={() => onChange(i)}
                            className={
                                'rounded-full px-[0.8rem] py-[0.35rem] text-[0.7rem] font-bold tracking-wide transition-all ' +
                                (active
                                    ? 'bg-secondary-container text-on-secondary-container'
                                    : 'bg-surface-container text-on-surface hover:bg-surface-container-high')
                            }>
                            {i.displayName}
                        </button>
                    )
                })}
                {filtered.length === 0 && (
                    <span className="text-[0.7rem] text-on-surface-variant px-[0.4rem] py-[0.4rem]">
                        No instruments match &ldquo;{search}&rdquo;
                    </span>
                )}
            </div>
        </div>
    )
}
