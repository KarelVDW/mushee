'use client'

import { type ReactNode, type RefObject, useRef, useState } from 'react'

import { ChipToggle } from '@/components/ui'

/**
 * The compact popover sheet: full viewport width just above the dock, scrolling when tall.
 * Shared with the in-score attribute popovers (ScoreAttributePopover), which position it
 * against a `relative` wrapper around the dock rather than the dock's own containing block.
 */
export const COMPACT_POPOVER_SHEET = 'inset-x-2 bottom-full mb-2 w-auto! max-h-[60vh] overflow-y-auto'

/**
 * Popovers open upward from the dock, clear of its glass panel. In compact (mobile)
 * mode they become a sheet spanning the dock's width instead — anchored popovers
 * would clip at the viewport edges. (`fixed` resolves against the dock, whose
 * backdrop-filter makes it the containing block; the dock spans the viewport.)
 */
function popoverPosition(compact: boolean): string {
    return compact ? `fixed! ${COMPACT_POPOVER_SHEET}` : 'right-0 bottom-[calc(100%+0.75rem)]'
}

interface PopoverChipProps {
    ariaLabel: string
    disabled?: boolean
    /** Phone layout: the popover opens as the dock-wide sheet (see {@link popoverPosition}). */
    compact: boolean
    /** Transparent at rest, for a chip inside a ToolGroup well (see ChipToggle). */
    plain?: boolean
    /** The chip's face. */
    chip: ReactNode
    /** Positioning classes for the popover; defaults to the dock's {@link popoverPosition}. */
    className?: string
    /** Controlled open state, for a popover something else can open too (Shift+T opens transpose). */
    open?: boolean
    onOpenChange?: (open: boolean) => void
    /** The popover, mounted only while open: anchor it at `anchorRef`, position it with `className`, dismiss with `close`. */
    children: (popover: { anchorRef: RefObject<HTMLDivElement | null>; className: string; close: () => void }) => ReactNode
}

/**
 * A chip that toggles an anchored popover — the one place the toggle and dismissal wiring
 * lives, for the tool dock's chips and the pitch tools' transpose chip alike. The anchor
 * wraps the chip, so the popover's outside-click dismissal ignores the chip and its own
 * toggle isn't fought. Owns its open state unless `open` is passed.
 */
export function PopoverChip({
    ariaLabel,
    disabled,
    compact,
    plain = false,
    chip,
    className,
    open: controlledOpen,
    onOpenChange,
    children,
}: PopoverChipProps) {
    const anchorRef = useRef<HTMLDivElement | null>(null)
    const [ownOpen, setOwnOpen] = useState(false)
    const open = controlledOpen ?? ownOpen
    const setOpen = (next: boolean) => {
        if (controlledOpen === undefined) setOwnOpen(next)
        onOpenChange?.(next)
    }
    const close = () => setOpen(false)

    return (
        <div ref={anchorRef} className="relative">
            <ChipToggle plain={plain} active={open} disabled={disabled} onClick={() => setOpen(!open)} ariaLabel={ariaLabel}>
                {chip}
            </ChipToggle>
            {open && children({ anchorRef, className: className ?? popoverPosition(compact), close })}
        </div>
    )
}
