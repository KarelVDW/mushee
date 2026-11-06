'use client'

import { TimeSignatureIcon } from '@mushee/notation/components'
import { TimeSignature } from '@mushee/notation/model'
import { type ReactNode, useState } from 'react'

import { Popover, PopoverExpander, PopoverOption } from '@/components/ui'

/** The meters a newcomer reaches for, shown first. */
const COMMON_METERS: TimeSignature[] = [new TimeSignature(4, 4), new TimeSignature(3, 4), new TimeSignature(2, 4), new TimeSignature(6, 8)]
/** The rest, behind "More time signatures". */
const MORE_METERS: TimeSignature[] = [
    new TimeSignature(2, 2),
    new TimeSignature(5, 4),
    new TimeSignature(3, 8),
    new TimeSignature(7, 8),
    new TimeSignature(9, 8),
    new TimeSignature(12, 8),
]

interface TimeSignaturePopoverProps {
    active: { beatAmount: number; beatType: number }
    onSelect: (beatAmount: number, beatType: number) => void
    onDismiss: () => void
    /** Extra positioning/layout classes (e.g. `right-0 top-full`); ignored by a sheet, which its host positions. */
    className?: string
    /** Trigger element to exclude from outside-click dismissal, so its toggle isn't fought by the popover. */
    anchorRef?: { current: HTMLElement | null }
    /** `sheet` on phones: the full-width sheet above the dock (see Popover). */
    variant?: 'anchored' | 'sheet'
    /** The way back — the More sheet's Back link, which a sheet shows above its title (Popover `lead`). */
    lead?: ReactNode
}

/**
 * The meter picker: the four common meters first, as bare numerals, and the rest behind
 * "More time signatures" — open from the start when the score's meter is one of them.
 */
export function TimeSignaturePopover({
    active,
    onSelect,
    onDismiss,
    className,
    anchorRef,
    variant = 'anchored',
    lead,
}: TimeSignaturePopoverProps) {
    const isActive = (meter: TimeSignature) => meter.beatAmount === active.beatAmount && meter.beatType === active.beatType
    const [expanded, setExpanded] = useState(() => MORE_METERS.some(isActive))
    const sheet = variant === 'sheet'

    // The numerals alone, centred in a tile; the picked check sits in its corner so the digits
    // never shift. Phones fill the sheet in four fluid columns.
    const cell = (meter: TimeSignature) => (
        <PopoverOption
            key={`${meter.beatAmount}/${meter.beatType}`}
            active={isActive(meter)}
            ariaLabel={`Set ${meter.beatAmount}/${meter.beatType} time`}
            onClick={() => onSelect(meter.beatAmount, meter.beatType)}
            layout="tile"
            className={`justify-center h-14 ${sheet ? 'w-full min-w-0' : 'w-18'}`}>
            <TimeSignatureIcon beatAmount={meter.beatAmount} beatType={meter.beatType} size={30} />
        </PopoverOption>
    )
    const row = sheet ? 'grid grid-cols-4 gap-1.5' : 'flex flex-wrap gap-1.5'

    return (
        <Popover
            ariaLabel="Select time signature"
            title="Time signature"
            hint="How many beats fit in each bar."
            onDismiss={onDismiss}
            anchorRef={anchorRef}
            variant={variant}
            lead={lead}
            className={sheet ? 'gap-2' : `w-86 gap-2${className ? ` ${className}` : ''}`}>
            <div role="group" aria-label="Time signature" className="flex flex-col gap-1.5">
                <div className={row}>{COMMON_METERS.map(cell)}</div>
                {expanded && <div className={row}>{MORE_METERS.map(cell)}</div>}
            </div>
            {!expanded && (
                <div>
                    <PopoverExpander onClick={() => setExpanded(true)}>More time signatures</PopoverExpander>
                </div>
            )}
        </Popover>
    )
}
