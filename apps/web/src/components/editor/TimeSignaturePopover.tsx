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
 * The meter picker: the four common meters first, each captioned with its beats in plain
 * words, and the rest behind "More time signatures" — open from the start when the score's
 * meter is one of them.
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

    const cell = (meter: TimeSignature) => (
        <PopoverOption
            key={`${meter.beatAmount}/${meter.beatType}`}
            active={isActive(meter)}
            ariaLabel={`Set ${meter.beatAmount}/${meter.beatType} time`}
            onClick={() => onSelect(meter.beatAmount, meter.beatType)}
            className="flex-col justify-center gap-1 w-18 h-18 px-1">
            <TimeSignatureIcon beatAmount={meter.beatAmount} beatType={meter.beatType} size={30} />
            <span className="font-label font-medium text-[11px] leading-tight text-center">{meter.plainName}</span>
        </PopoverOption>
    )

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
                <div className="flex flex-wrap gap-1.5">{COMMON_METERS.map(cell)}</div>
                {expanded && <div className="flex flex-wrap gap-1.5">{MORE_METERS.map(cell)}</div>}
            </div>
            {!expanded && (
                <div>
                    <PopoverExpander onClick={() => setExpanded(true)}>More time signatures</PopoverExpander>
                </div>
            )}
        </Popover>
    )
}
