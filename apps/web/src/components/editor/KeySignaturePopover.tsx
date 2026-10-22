'use client'

import { KeySignatureIcon } from '@mushee/notation/components'
import { KeySignature } from '@mushee/notation/model'
import { type ReactNode, useEffect, useRef } from 'react'

import { Popover, PopoverOption } from '@/components/ui'

// Key signatures grouped flats → C → sharps, each labelled by its major key.
const KEY_ROWS: number[][] = [[-7, -6, -5, -4, -3, -2, -1], [0], [1, 2, 3, 4, 5, 6, 7]]

/**
 * Cell, glyph and label sizes per grid size: `md` is the key-signature picker's own,
 * `sm` the tighter grid inside the transpose popover's key tab. Labels never go under 11px.
 */
const GRID_SIZES = {
    md: { gap: 'gap-1.5', cell: 'w-12 h-14 px-1 py-1.5', glyph: 32, label: 'text-[11px]' },
    sm: { gap: 'gap-1', cell: 'w-10.5 h-12 px-1 py-1', glyph: 26, label: 'text-[11px]' },
} as const

/**
 * A phone sheet's grid: seven fluid columns across the sheet (about 41px a cell at 360, 45px at
 * 390), so the flats and the sharps each stay one row instead of wrapping a key onto a row of
 * its own; the `sm` glyph, since a 32px seven-flat run wouldn't fit such a cell. C sits alone
 * in the middle column of its row.
 */
const FLUID_GRID = {
    row: 'grid grid-cols-7 gap-1 w-full',
    cell: 'w-full min-w-0 h-12 px-0.5 py-1',
    alone: 'col-start-4',
    glyph: 26,
} as const

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
    const glyph = fluid ? FLUID_GRID.glyph : sizes.glyph
    return (
        <div ref={gridRef} role="group" aria-label={ariaLabel} className="flex flex-col gap-1.5 items-center">
            {KEY_ROWS.map((row, i) => (
                <div key={i} className={rowClass}>
                    {row.map((fifths) => {
                        const name = KeySignature.majorKeyName(fifths)
                        const cell = fluid ? `${FLUID_GRID.cell}${row.length === 1 ? ` ${FLUID_GRID.alone}` : ''}` : sizes.cell
                        return (
                            <PopoverOption
                                key={fifths}
                                active={fifths === active}
                                ariaLabel={`${name} major`}
                                title={KeySignature.readingsOf(fifths)}
                                onClick={() => onSelect(fifths)}
                                className={`flex-col justify-end gap-0.5 ${cell}`}>
                                <span className="flex flex-1 items-center">
                                    <KeySignatureIcon fifths={fifths} size={glyph} />
                                </span>
                                <span className={`${sizes.label} leading-none font-medium`}>{name}</span>
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
    /** Rendered above the options — the More sheet's Back link. */
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
            className={sheet ? 'gap-2' : `w-104 gap-2${className ? ` ${className}` : ''}`}>
            {lead}
            <KeySignatureGrid ariaLabel="Key signature" active={active} onSelect={onSelect} size="md" fluid={sheet} />
        </Popover>
    )
}
