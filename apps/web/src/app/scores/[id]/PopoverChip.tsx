'use client'

import { type ReactNode, type RefObject, useRef, useState } from 'react'

import { ChipToggle, type TooltipShortcut } from '@/components/ui'

/** Where a dock popover opens on desktop: upward, right-aligned to its chip, clear of the dock. */
export const DOCK_POPOVER_POSITION = 'right-0 bottom-[calc(100%+0.75rem)]'

/** How a chip's popover is placed: anchored next to it, or (phones) as the sheet above the dock. */
export type PopoverVariant = 'anchored' | 'sheet'

interface PopoverChipProps {
    ariaLabel: string
    disabled?: boolean
    /** Why it is off: keeps the chip focusable, and its tooltip says this instead. */
    disabledReason?: string
    /** Phone layout: the popover opens as the sheet above the dock (Popover's `sheet` variant) instead of anchoring. */
    compact: boolean
    /** Transparent at rest, for a chip inside a ToolGroup well (see ChipToggle). */
    plain?: boolean
    /** The chip's face. */
    chip: ReactNode
    /** The tooltip's name line (defaults to the aria-label once a hint or shortcut is given), its hint and live shortcut. */
    tooltip?: string
    hint?: string
    shortcut?: TooltipShortcut
    /** `top` in the dock (the default), `bottom` in the header. */
    tooltipSide?: 'top' | 'bottom'
    /** Positioning classes for an anchored popover; defaults to the dock's {@link DOCK_POPOVER_POSITION}. */
    className?: string
    /** Controlled open state, for a popover something else can open too (Shift+T opens transpose). */
    open?: boolean
    onOpenChange?: (open: boolean) => void
    /**
     * The popover, mounted only while open: anchor it at `anchorRef`, position it with
     * `className` (anchored only), render it as `variant`, dismiss with `close`.
     */
    children: (popover: {
        anchorRef: RefObject<HTMLDivElement | null>
        className: string
        variant: PopoverVariant
        close: () => void
    }) => ReactNode
}

/**
 * A chip that toggles a popover — the one place the toggle and dismissal wiring lives, for
 * the tool dock's chips and the header's transpose chip alike. It is a menu trigger
 * (aria-haspopup + aria-expanded), not a toggle. The anchor wraps the chip, so the popover's
 * outside-click dismissal ignores the chip and its own toggle isn't fought. Owns its open
 * state unless `open` is passed.
 */
export function PopoverChip({
    ariaLabel,
    disabled,
    disabledReason,
    compact,
    plain = false,
    chip,
    tooltip,
    hint,
    shortcut,
    tooltipSide,
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
    const variant: PopoverVariant = compact ? 'sheet' : 'anchored'

    return (
        <div ref={anchorRef} className="relative">
            <ChipToggle
                popup
                plain={plain}
                active={open}
                disabled={disabled}
                disabledReason={disabledReason}
                onClick={() => setOpen(!open)}
                ariaLabel={ariaLabel}
                tooltip={tooltip}
                hint={hint}
                shortcut={shortcut}
                tooltipSide={tooltipSide}>
                {chip}
            </ChipToggle>
            {open && children({ anchorRef, className: className ?? DOCK_POPOVER_POSITION, variant, close })}
        </div>
    )
}
