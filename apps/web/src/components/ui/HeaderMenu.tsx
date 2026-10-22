'use client'

import { Icon, type IconName } from '@mushee/ui'
import { type ReactNode, useCallback, useRef, useState } from 'react'

import { ChipToggle } from './Controls'
import { Popover } from './Popover'

/** Phone menus stay this far inside the viewport edges, whichever chip they hang from. */
const VIEWPORT_GUTTER_PX = 16

interface HeaderMenuProps {
    icon: IconName
    /** Visible chip text beside the icon ('Export', 'Download'); hidden when `compact`, absent for an icon-only chip. */
    label?: string
    /** Icon-only trigger (the mobile header). */
    compact?: boolean
    /** Accessible name of both the trigger chip and its panel. It must contain the visible `label` (WCAG 2.5.3). */
    ariaLabel: string
    /** The panel's eyebrow heading ('Export as', 'Download as'). */
    title: ReactNode
    /** A plain line for the icon-only chip's tooltip, after its name. */
    tooltipHint?: string
    /** Width and gap classes for the panel. */
    className?: string
    /** Panel content, mounted only while open. A function receives `close`, for content that dismisses the menu itself. */
    children: ReactNode | ((menu: { close: () => void }) => ReactNode)
}

/**
 * A score-level chip in a header (Share, Recordings, Export) that opens a downward panel.
 * Owns the open state, the anchor and the trigger — a ChipToggle in popup mode, so it
 * announces aria-haspopup + aria-expanded rather than a pressed state. The panel is an
 * opaque Popover with focus management on (focus moves into it on open and back to the chip
 * when it closes with focus inside), kept 16px inside the viewport so a phone panel hanging
 * from a chip near the left edge never runs off screen. An icon-only chip names itself in a
 * tooltip below it.
 */
export function HeaderMenu({ icon, label, compact = false, ariaLabel, title, tooltipHint, className, children }: HeaderMenuProps) {
    const [open, setOpen] = useState(false)
    const anchorRef = useRef<HTMLDivElement>(null)
    const close = useCallback(() => setOpen(false), [])
    const iconOnly = compact || !label

    return (
        <div ref={anchorRef} className="relative shrink-0">
            <ChipToggle
                popup
                active={open}
                onClick={() => setOpen((o) => !o)}
                ariaLabel={ariaLabel}
                tooltip={iconOnly ? (label ?? ariaLabel) : undefined}
                hint={iconOnly ? tooltipHint : undefined}
                tooltipSide="bottom">
                <span className="inline-flex items-center gap-1.5">
                    <Icon name={icon} size={14} />
                    {!iconOnly && label}
                </span>
            </ChipToggle>
            {open && (
                <Popover
                    ariaLabel={ariaLabel}
                    title={title}
                    anchorRef={anchorRef}
                    onDismiss={close}
                    manageFocus
                    viewportGutter={VIEWPORT_GUTTER_PX}
                    className={`right-0 top-[calc(100%+0.5rem)] max-w-[calc(100vw-2rem)]${className ? ` ${className}` : ''}`}>
                    {typeof children === 'function' ? children({ close }) : children}
                </Popover>
            )}
        </div>
    )
}
