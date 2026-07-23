'use client'

import { Instrument } from '@mushee/notation/model'
import { useMemo, useState } from 'react'

import { Chip, Eyebrow, TextField } from '@/components/ui'

interface InstrumentPickerProps {
    value: Instrument
    onChange: (instrument: Instrument) => void
}

export function InstrumentPicker({ value, onChange }: InstrumentPickerProps) {
    const [search, setSearch] = useState('')

    const groups = useMemo(() => {
        const q = search.trim().toLowerCase()
        return Instrument.selectableByCategory()
            .map(({ category, instruments }) => ({
                category,
                instruments: q ? instruments.filter((i) => i.displayName.toLowerCase().includes(q)) : instruments,
            }))
            .filter((group) => group.instruments.length > 0)
    }, [search])

    return (
        <div className="flex flex-col gap-2.5 flex-1 min-h-0">
            <Eyebrow>Lead instrument · {value.displayName}</Eyebrow>
            <TextField value={search} onChange={setSearch} leftIcon="search" placeholder="Filter instruments…" />
            <div className="flex-1 min-h-40 overflow-y-auto flex flex-col gap-3.5 py-1">
                {groups.map(({ category, instruments }) => (
                    <div key={category} className="flex flex-col gap-2">
                        <Eyebrow>{category}</Eyebrow>
                        <div className="flex flex-wrap gap-2">
                            {instruments.map((i) => (
                                <Chip
                                    key={i.id}
                                    active={i.id === value.id}
                                    onClick={() => onChange(i)}
                                    ariaLabel={`Pick ${i.displayName}`}>
                                    {i.displayName}
                                </Chip>
                            ))}
                        </div>
                    </div>
                ))}
                {groups.length === 0 && (
                    <span className="font-body font-normal text-[13px] leading-normal text-on-surface-variant p-1">
                        No instruments match &ldquo;{search}&rdquo;
                    </span>
                )}
            </div>
        </div>
    )
}
