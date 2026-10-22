'use client'

import { Glyph, Staff } from '@mushee/notation/components'
import { TimeSignature } from '@mushee/notation/model'
import { useMemo } from 'react'

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

/** Room kept around the digits on every side of the glyph's window. */
const GLYPH_MARGIN = 2

/** Stacked meter digits (e.g. 6 over 8), drawn from the same layout the staff uses. */
export function TimeSignatureGlyph({
    beatAmount,
    beatType,
    size = 30,
    color = 'currentColor',
}: {
    beatAmount: number
    beatType: number
    size?: number
    color?: string
}) {
    const layout = useMemo(() => new TimeSignature(beatAmount, beatType).layout, [beatAmount, beatType])
    const { topDigits, bottomDigits } = layout
    const { paddingLeft, content } = layout.width
    // Window over the digits' content box (the staff padding trimmed) and the staff band:
    // the digits sit on lines 1 and 3, each spanning a space up and down.
    const left = paddingLeft - GLYPH_MARGIN
    const width = content + 2 * GLYPH_MARGIN
    const top = Staff.TOP_Y - GLYPH_MARGIN
    const height = Staff.HEIGHT + 2 * GLYPH_MARGIN
    return (
        <svg width={(size * width) / height} height={size} viewBox={`${left} ${top} ${width} ${height}`} aria-hidden>
            {[...topDigits, ...bottomDigits].map((digit, i) => (
                <Glyph key={i} name={digit.glyphName} x={digit.x} y={digit.y} scale={digit.scale} fill={color} />
            ))}
        </svg>
    )
}

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
                                <TimeSignatureGlyph beatAmount={beatAmount} beatType={beatType} size={30} />
                            </PopoverOption>
                        ))}
                    </div>
                ))}
            </div>
        </Popover>
    )
}
