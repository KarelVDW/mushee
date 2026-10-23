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
    /** The panel's title, in sentence case ('Share a read-only link', 'Download as'). */
    title: ReactNode
    /** A plain line for the icon-only chip's tooltip, after its name. */
    tooltipHint?: string
    /** Width and gap classes for the panel (a `sheet` keeps only the gap, for its content). */
    className?: string
    /**
     * The phone header's form: the panel is a full-width floating card under the header — the
     * dock sheets' card, titled at the sheet size with a 40px Close — instead of a dropdown with
     * the score peeking past it. Only the phone layout passes it.
     */
    sheet?: boolean
    /** `lg`: a 44px chip with a 14px label, beside a page's big CTA (the shared score's Download). */
    size?: 'default' | 'lg'
    /** Panel content, mounted only while open. A function receives `close`, for content that dismisses the menu itself. */
    children: ReactNode | ((menu: { close: () => void }) => ReactNode)
}

/**
 * A score-level chip in a header (Share, Recordings, Export) that opens a downward panel.
 * Owns the open state, the anchor and the trigger — a ChipToggle in popup mode, so it
 * announces aria-haspopup + aria-expanded rather than a pressed state, and turns a tone darker
 * while open. The panel is an opaque Popover with focus management on (focus moves into it on
 * open and back to the chip when it closes with focus inside), kept 16px inside the viewport so
 * a phone panel hanging from a chip near the left edge never runs off screen — or, with `sheet`,
 * the full-width header card. An icon-only chip is a circle and names itself in a tooltip below it.
 */
export function HeaderMenu({
    icon,
    label,
    compact = false,
    ariaLabel,
    title,
    tooltipHint,
    className,
    sheet = false,
    size = 'default',
    children,
}: HeaderMenuProps) {
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
                tooltipSide="bottom"
                size={size}
                round={iconOnly}>
                {iconOnly ? (
                    // 16px on a mouse, 18px under a finger.
                    <span className="inline-flex items-center">
                        <span className="inline-flex pointer-coarse:hidden">
                            <Icon name={icon} size={16} />
                        </span>
                        <span className="hidden pointer-coarse:inline-flex">
                            <Icon name={icon} size={18} />
                        </span>
                    </span>
                ) : (
                    <span className="inline-flex items-center gap-1.5">
                        <Icon name={icon} size={14} />
                        {label}
                    </span>
                )}
            </ChipToggle>
            {open && (
                <Popover
                    ariaLabel={ariaLabel}
                    title={title}
                    anchorRef={anchorRef}
                    onDismiss={close}
                    manageFocus
                    variant={sheet ? 'header-sheet' : 'anchored'}
                    viewportGutter={VIEWPORT_GUTTER_PX}
                    className={sheet ? className : `right-0 top-[calc(100%+0.5rem)] max-w-[calc(100vw-2rem)]${className ? ` ${className}` : ''}`}>
                    {typeof children === 'function' ? children({ close }) : children}
                </Popover>
            )}
        </div>
    )
}
