'use client'

import { TimeSignatureIcon } from '@mushee/notation/components'
import { TimeSignature } from '@mushee/notation/model'
import { type ReactNode, useState } from 'react'

import { Popover, PopoverOption, TertiaryButton } from '@/components/ui'

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

/**
 * A meter in plain words, counted in the beat the metronome and the count-in click
 * (TimeSignature.pulse): "4 beats", "2 swaying beats" (6/8), "2 long beats" (2/2),
 * "3 quick beats" (3/8). Deriving the words from the pulse keeps them from ever
 * contradicting what the user hears.
 */
export class MeterWords {
    constructor(readonly timeSignature: TimeSignature) {}

    /** How each beat feels: swaying (compound), long (a half-note pulse), quick (an eighth), or plain. */
    get feel(): string | null {
        const { timeSignature } = this
        if (timeSignature.isCompound) return 'swaying'
        const beats = timeSignature.pulse.beats
        if (beats > 1) return 'long'
        if (beats < 1) return 'quick'
        return null
    }

    /** "4 beats", "2 swaying beats". */
    get beats(): string {
        const count = this.timeSignature.pulsesPerMeasure
        const noun = count === 1 ? 'beat' : 'beats'
        return [count, this.feel, noun].filter(Boolean).join(' ')
    }

    /** "4 beats in a bar". */
    get perBar(): string {
        return `${this.beats} in a bar`
    }
}

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
    /** Rendered above the options — the More sheet's Back link. */
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
            <span className="font-label font-medium text-[11px] leading-tight text-center">{new MeterWords(meter).beats}</span>
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
            className={sheet ? 'gap-2' : `w-86 gap-2${className ? ` ${className}` : ''}`}>
            {lead}
            <div role="group" aria-label="Time signature" className="flex flex-col gap-1.5">
                <div className="flex flex-wrap gap-1.5">{COMMON_METERS.map(cell)}</div>
                {expanded && <div className="flex flex-wrap gap-1.5">{MORE_METERS.map(cell)}</div>}
            </div>
            {!expanded && (
                <div>
                    <TertiaryButton onClick={() => setExpanded(true)}>More time signatures</TertiaryButton>
                </div>
            )}
        </Popover>
    )
}
