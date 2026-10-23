'use client'

import { AccidentalIcon, KeySignatureIcon } from '@mushee/notation/components'
import { KeySignature } from '@mushee/notation/model'
import { type ReactNode, useEffect, useRef } from 'react'

import { Popover, PopoverOption } from '@/components/ui'

// Key signatures grouped flats → C → sharps, each labelled by its major key.
const KEY_ROWS: number[][] = [[-7, -6, -5, -4, -3, -2, -1], [0], [1, 2, 3, 4, 5, 6, 7]]

/**
 * Cell, staff and label sizes per grid size: `md` is the key-signature picker's own, `sm` the
 * tighter grid inside the transpose popover's key tab. Each signature sits on a faint staff of
 * `staff` px (KeySignatureIcon `staff`), its lines `staffWidth` px long however few accidentals ride
 * on them (a long run widens it), so the accidentals read as a key, not specks.
 */
const GRID_SIZES = {
    md: { gap: 'gap-1.5', cell: 'w-12 h-16 px-1 py-1', staff: 24, staffWidth: 40, label: 'text-[12px]' },
    sm: { gap: 'gap-1', cell: 'w-10.5 h-14 px-0.5 py-1', staff: 20, staffWidth: 34, label: 'text-[12px]' },
} as const

/**
 * A phone sheet's grid: seven fluid columns across the sheet (about 41px a cell at 360, 45px at
 * 390), so the flats and the sharps each stay one row instead of wrapping a key onto a row of
 * its own — on a 22px staff a seven-sharp run is 40px wide, so it fits the narrowest cell.
 */
const FLUID_GRID = {
    row: 'grid grid-cols-7 gap-1 w-full',
    cell: 'w-full min-w-0 h-16 px-0.5 py-1',
    staff: 22,
    staffWidth: 36,
    label: 'text-[13px]',
} as const

/** The C tile: the one key with nothing to draw, a wide row of its own between the flats and the sharps. */
const C_TILE = 'w-full h-11 flex-row gap-2.5 justify-center px-3'
/** The C tile's short empty staff, as tall as the other keys' staves. */
const C_STAFF_WIDTH = 40

/** A key's name drawn for a tile: its letter, then the alteration as notation (never the UI font's ♭ ♯). */
function KeyName({ fifths, className }: { fifths: number; className: string }) {
    const name = KeySignature.majorKeyName(fifths)
    const alter = name.endsWith('♯') ? 1 : name.endsWith('♭') ? -1 : 0
    return (
        <span className={`inline-flex items-center gap-px font-semibold leading-none ${className}`}>
            {name.charAt(0)}
            {alter !== 0 && <AccidentalIcon alter={alter} size={11} />}
        </span>
    )
}

interface KeySignatureGridProps {
    /** The highlighted key's fifths, or null for none. */
    active: number | null
    onSelect: (fifths: number) => void
    size: keyof typeof GRID_SIZES
    /** Fill the width in seven fluid columns (a phone sheet) instead of fixed cells in wrapping rows. */
    fluid?: boolean
    /** The group's accessible name. */
    ariaLabel: string
}

/**
 * The fifteen drawable keys as a grid of signature glyphs, each named by its major key (the
 * hover title gives both readings, "D major · B minor"), read flats → C → sharps. The active
 * key scrolls into view on open, so a phone sheet that clips the grid still shows where the
 * score is.
 */
export function KeySignatureGrid({ active, onSelect, size, fluid = false, ariaLabel }: KeySignatureGridProps) {
    const sizes = GRID_SIZES[size]
    const gridRef = useRef<HTMLDivElement>(null)
    useEffect(() => {
        gridRef.current?.querySelector<HTMLElement>('[aria-pressed="true"]')?.scrollIntoView?.({ block: 'nearest' })
        // Only on open: a pick closes the picker, and scrolling under the user's finger mid-browse would jump.
    }, [])
    const rowClass = fluid ? FLUID_GRID.row : `flex flex-wrap justify-center ${sizes.gap}`
    const { staff, staffWidth, label } = fluid ? FLUID_GRID : sizes
    return (
        // As wide as a row of seven keys (or the sheet, fluid), so the C tile spans exactly the rows above and below it.
        <div
            ref={gridRef}
            role="group"
            aria-label={ariaLabel}
            className={`flex flex-col gap-1.5 items-stretch ${fluid ? 'w-full' : 'w-max max-w-full mx-auto'}`}>
            {KEY_ROWS.map((row, i) => (
                <div key={i} className={rowClass}>
                    {row.map((fifths) => {
                        const name = KeySignature.majorKeyName(fifths)
                        const common = {
                            active: fifths === active,
                            ariaLabel: `${name} major`,
                            title: KeySignature.readingsOf(fifths),
                            onClick: () => onSelect(fifths),
                            layout: 'cell' as const,
                        }
                        if (fifths === 0) {
                            return (
                                <PopoverOption key={fifths} {...common} className={`${C_TILE}${fluid ? ' col-span-7' : ''}`}>
                                    <KeySignatureIcon fifths={0} size={staff} staff width={C_STAFF_WIDTH} />
                                    <span className="font-semibold text-[12px] leading-none">C</span>
                                    <span className="font-body font-normal text-[12px] leading-none text-on-surface-variant">
                                        no sharps or flats
                                    </span>
                                </PopoverOption>
                            )
                        }
                        return (
                            <PopoverOption
                                key={fifths}
                                {...common}
                                className={`flex-col justify-end gap-0.5 ${fluid ? FLUID_GRID.cell : sizes.cell}`}>
                                <span className="flex flex-1 items-center">
                                    <KeySignatureIcon fifths={fifths} size={staff} staff width={staffWidth} />
                                </span>
                                <KeyName fifths={fifths} className={label} />
                            </PopoverOption>
                        )
                    })}
                </div>
            ))}
        </div>
    )
}

interface KeySignaturePopoverProps {
    active: number
    onSelect: (fifths: number) => void
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

export function KeySignaturePopover({
    active,
    onSelect,
    onDismiss,
    className,
    anchorRef,
    variant = 'anchored',
    lead,
}: KeySignaturePopoverProps) {
    const sheet = variant === 'sheet'
    return (
        <Popover
            ariaLabel="Select key signature"
            title="Key signature"
            hint="The sharps or flats used all the way through. Not sure? Leave it on C."
            onDismiss={onDismiss}
            anchorRef={anchorRef}
            variant={variant}
            lead={lead}
            className={sheet ? 'gap-2' : `w-104 gap-2${className ? ` ${className}` : ''}`}>
            <KeySignatureGrid ariaLabel="Key signature" active={active} onSelect={onSelect} size="md" fluid={sheet} />
        </Popover>
    )
}
