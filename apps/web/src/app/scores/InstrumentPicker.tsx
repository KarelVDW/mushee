'use client'

import { Instrument } from '@mushee/notation/model'
import { useId, useMemo, useState } from 'react'

import { Chip, Eyebrow, Icon, TextField } from '@/components/ui'

/** A plain line under a tile whose name alone undersells it. */
const TILE_SUBLINES: ReadonlyMap<string, string> = new Map([[Instrument.VoiceLead.id, 'Sing, hum or whistle']])

function isPopular(instrument: Instrument): boolean {
    return Instrument.popular().includes(instrument)
}

/** Whether a filter query (already trimmed and lower-cased) names the instrument, by its current or an old name. */
function matchesQuery(instrument: Instrument, query: string): boolean {
    return [instrument.displayName, ...instrument.legacyNames].some((name) => name.toLowerCase().includes(query))
}

/**
 * The one line a chordal pick earns (contract C13): Solkey writes melodies, one note at a
 * time. Plain 13px text — never a banner, an icon or a warning. Onboarding reuses it.
 */
export function InstrumentChordHint({ instrument }: { instrument: Instrument }) {
    return (
        <p className="m-0 font-body font-normal text-[13px] leading-[1.4] text-on-surface-variant">
            On {instrument.displayName.toLowerCase()}, play the tune one note at a time — Solkey writes melodies.
        </p>
    )
}

type PopularInstrumentTilesProps = {
    /** The tiles to show; the popular eight by default. */
    instruments?: ReadonlyArray<Instrument>
} & (
    | { multiple?: false; value: Instrument; onChange: (instrument: Instrument) => void }
    | { multiple: true; value: ReadonlyArray<Instrument>; onChange: (instruments: Instrument[]) => void }
)

/**
 * The popular instruments as big tiles — at least 48px tall, a 15px name, two columns on a
 * phone and four from `sm` — each named 'Pick {instrument}'. Single choice for the score
 * pickers; `multiple` toggles each tile on its own (onboarding's "What will you record?").
 */
export function PopularInstrumentTiles(props: PopularInstrumentTilesProps) {
    const instruments = props.instruments ?? Instrument.popular()
    const idPrefix = useId()
    const isActive = (instrument: Instrument) => (props.multiple ? props.value.includes(instrument) : props.value.id === instrument.id)
    const pick = (instrument: Instrument) => {
        if (!props.multiple) return props.onChange(instrument)
        props.onChange(isActive(instrument) ? props.value.filter((i) => i !== instrument) : [...props.value, instrument])
    }
    return (
        <div role="group" aria-label="Popular instruments" className="grid grid-cols-2 sm:grid-cols-4 auto-rows-fr gap-2">
            {instruments.map((instrument) => {
                const active = isActive(instrument)
                const subline = TILE_SUBLINES.get(instrument.id)
                const sublineId = `${idPrefix}-${instrument.id}`
                return (
                    <button
                        key={instrument.id}
                        type="button"
                        aria-label={`Pick ${instrument.displayName}`}
                        aria-pressed={active}
                        aria-describedby={subline ? sublineId : undefined}
                        onClick={() => pick(instrument)}
                        className={[
                            'flex flex-col items-start justify-center gap-0.5 min-h-12 px-3 py-2.5 rounded-md border-0 text-left cursor-pointer',
                            'transition-colors duration-150 ease-solkey focus-ring',
                            active
                                ? 'bg-secondary-soft text-on-secondary-soft'
                                : 'bg-surface-container text-on-surface hover:bg-surface-container-high',
                        ].join(' ')}>
                        <span className="font-body font-medium text-[15px] leading-tight">{instrument.displayName}</span>
                        {subline && (
                            <span
                                id={sublineId}
                                className={`font-body font-normal text-[12px] leading-tight ${active ? 'text-on-secondary-soft' : 'text-on-surface-variant'}`}>
                                {subline}
                            </span>
                        )}
                    </button>
                )
            })}
        </div>
    )
}

interface InstrumentPickerProps {
    value: Instrument
    onChange: (instrument: Instrument) => void
    /** The one-line melody note under the label while a chordal instrument is picked (contract C13). Off for imports. */
    chordHint?: boolean
    /** Focus the search field on mount — when the picker opens on request (the import dialog's 'Change'). */
    autoFocusSearch?: boolean
}

/**
 * The instrument choice every score dialog shares (New score, Import, Change instrument):
 * the popular eight as tiles, every other pickable instrument behind 'All instruments'
 * (grouped by family, the popular ones left out so each 'Pick X' name exists once), and a
 * search field that searches them all. The list opens by itself while searching or when
 * the current instrument isn't a popular one; a hidden duplicate a score already uses
 * (an imported Horn in C) still shows, selected, in its family. The picked tile or chip is
 * the only readout of the choice — no 'Instrument · Piano' line repeats it.
 */
export function InstrumentPicker({ value, onChange, chordHint = true, autoFocusSearch }: InstrumentPickerProps) {
    const labelId = useId()
    const [search, setSearch] = useState('')
    const [initial] = useState(value)
    const [expanded, setExpanded] = useState(() => !isPopular(value))
    // A value that arrives later (the onboarding default resolving) and isn't popular opens the list too.
    const [shownValue, setShownValue] = useState(value)
    if (shownValue !== value) {
        setShownValue(value)
        if (!isPopular(value)) setExpanded(true)
    }

    const query = search.trim().toLowerCase()
    const groups = useMemo(() => {
        // Pickers hide duplicates and section patches, except one this score already carries.
        const hidden = [initial, value].filter((i, index, all) => !i.isPickable && all.indexOf(i) === index)
        const offered = [...Instrument.pickable(), ...hidden]
        return Instrument.byCategory(query ? offered.filter((i) => matchesQuery(i, query)) : offered.filter((i) => !isPopular(i)))
    }, [query, initial, value])

    const showFamilies = query !== '' || expanded

    return (
        <div role="group" aria-labelledby={labelId} className="flex flex-col gap-3 flex-1 min-h-0">
            <div className="flex flex-col">
                <span id={labelId} className="font-label font-semibold text-[14px] leading-tight text-on-surface">
                    What will you sing or play?
                </span>
                <span className="mt-1 font-body font-normal text-[12px] leading-[1.4] text-on-surface-variant">
                    Sets the playback sound and helps Solkey listen.
                </span>
                {chordHint && (
                    // Always mounted, so a screen reader hears the line the moment a chordal pick adds it.
                    <div aria-live="polite">
                        {value.playsChords && (
                            <div className="mt-1.5">
                                <InstrumentChordHint instrument={value} />
                            </div>
                        )}
                    </div>
                )}
            </div>
            <TextField
                value={search}
                onChange={setSearch}
                leftIcon="search"
                placeholder="Filter instruments…"
                ariaLabel="Search instruments"
                clearLabel="Clear search"
                autoFocus={autoFocusSearch}
            />
            <div className="flex-1 min-h-40 overflow-y-auto flex flex-col gap-3.5 py-1">
                {query === '' && (
                    <>
                        <PopularInstrumentTiles value={value} onChange={onChange} />
                        <button
                            type="button"
                            aria-expanded={expanded}
                            onClick={() => setExpanded((open) => !open)}
                            className={[
                                'self-start inline-flex items-center gap-1.5 bg-transparent border-0 cursor-pointer py-2 px-0 pointer-coarse:min-h-10',
                                'font-body font-medium text-[13px] leading-none text-on-surface-variant hover:text-primary',
                                'transition-colors duration-150 ease-solkey focus-ring rounded-sm',
                            ].join(' ')}>
                            All instruments
                            <Icon name={expanded ? 'chevron-up' : 'chevron-down'} size={14} />
                        </button>
                    </>
                )}
                {showFamilies &&
                    groups.map(({ category, instruments }) => (
                        <div key={category} className="flex flex-col gap-2">
                            <Eyebrow>{category}</Eyebrow>
                            <div className="flex flex-wrap gap-2">
                                {instruments.map((i) => (
                                    <Chip
                                        key={i.id}
                                        size="md"
                                        active={i.id === value.id}
                                        onClick={() => onChange(i)}
                                        ariaLabel={`Pick ${i.displayName}`}>
                                        {i.displayName}
                                    </Chip>
                                ))}
                            </div>
                        </div>
                    ))}
                {query !== '' && groups.length === 0 && (
                    <span className="font-body font-normal text-[13px] leading-normal text-on-surface-variant p-1">
                        No instruments match &ldquo;{search.trim()}&rdquo;
                    </span>
                )}
            </div>
        </div>
    )
}
