'use client'

import { TimeSignatureIcon } from '@mushee/notation/components'

import { Popover, PopoverOption } from '@/components/ui'

// Common meters: quarter/half-based on top, eighth-based below.
const TIME_SIGNATURE_ROWS: Array<Array<[number, number]>> = [
    [
        [2, 2],
        [2, 4],
        [3, 4],
        [4, 4],
        [5, 4],
    ],
    [
        [3, 8],
        [6, 8],
        [7, 8],
        [9, 8],
        [12, 8],
    ],
]

interface TimeSignaturePopoverProps {
    active: { beatAmount: number; beatType: number }
    onSelect: (beatAmount: number, beatType: number) => void
    onDismiss: () => void
    /** Extra positioning/layout classes (e.g. `right-0 top-full`). */
    className?: string
    /** Trigger element to exclude from outside-click dismissal, so its toggle isn't fought by the popover. */
    anchorRef?: { current: HTMLElement | null }
}

export function TimeSignaturePopover({ active, onSelect, onDismiss, className, anchorRef }: TimeSignaturePopoverProps) {
    return (
        <Popover
            ariaLabel="Select time signature"
            title="Time signature"
            onDismiss={onDismiss}
            anchorRef={anchorRef}
            className={`w-max gap-2${className ? ` ${className}` : ''}`}>
            <div role="group" aria-label="Time signature" className="flex flex-col gap-1.5">
                {TIME_SIGNATURE_ROWS.map((row, i) => (
                    <div key={i} className="flex flex-wrap gap-1.5">
                        {row.map(([beatAmount, beatType]) => (
                            <PopoverOption
                                key={`${beatAmount}/${beatType}`}
                                active={beatAmount === active.beatAmount && beatType === active.beatType}
                                ariaLabel={`Set ${beatAmount}/${beatType} time`}
                                title={`${beatAmount}/${beatType}`}
                                onClick={() => onSelect(beatAmount, beatType)}
                                className="justify-center w-11 h-12">
                                <TimeSignatureIcon beatAmount={beatAmount} beatType={beatType} size={30} />
                            </PopoverOption>
                        ))}
                    </div>
                ))}
            </div>
        </Popover>
    )
}
