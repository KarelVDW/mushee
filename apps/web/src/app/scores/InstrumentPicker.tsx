'use client'

import { useMemo, useState } from 'react'

import { Chip, Eyebrow, TextField } from '@/components/ui'
import { Instrument } from '@/model'

interface InstrumentPickerProps {
    value: Instrument
    onChange: (instrument: Instrument) => void
}

export function InstrumentPicker({ value, onChange }: InstrumentPickerProps) {
    const [search, setSearch] = useState('')

    const filtered = useMemo(() => {
        const q = search.trim().toLowerCase()
        const all = Instrument.selectable()
        if (!q) return all
        return all.filter((i) => i.displayName.toLowerCase().includes(q))
    }, [search])

    return (
        <div className="flex flex-col gap-2.5 flex-1 min-h-0">
            <Eyebrow>Lead instrument · {value.displayName}</Eyebrow>
            <TextField value={search} onChange={setSearch} leftIcon="search" placeholder="Filter instruments…" />
            <div className="flex-1 min-h-40 overflow-y-auto flex flex-wrap gap-2 content-start py-1">
                {filtered.map((i) => (
                    <Chip key={i.id} active={i.id === value.id} onClick={() => onChange(i)} ariaLabel={`Pick ${i.displayName}`}>
                        {i.displayName}
                    </Chip>
                ))}
                {filtered.length === 0 && (
                    <span className="font-body font-normal text-[13px] leading-normal text-on-surface-variant p-1">
                        No instruments match &ldquo;{search}&rdquo;
                    </span>
                )}
            </div>
        </div>
    )
}
