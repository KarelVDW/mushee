'use client'

import { type ReactNode, useCallback, useRef, useState } from 'react'

import { ChipToggle } from './Controls'
import { Icon, type IconName } from './Icon'
import { Popover } from './Popover'

interface HeaderMenuProps {
    icon: IconName
    /** Chip text beside the icon; hidden when `compact`. */
    label: string
    /** Icon-only trigger (the mobile header). */
    compact?: boolean
    /** Accessible name of both the trigger chip and its panel. */
    ariaLabel: string
    /** The panel's eyebrow heading. */
    title: ReactNode
    /** Width and gap classes for the panel. */
    className?: string
    /** Panel content, mounted only while open. A function receives `close`, for content that dismisses the menu itself. */
    children: ReactNode | ((menu: { close: () => void }) => ReactNode)
}

/**
 * A score-level chip in a header (Share, Takes, Export) that opens a downward glass
 * panel. Owns the open state, the anchor and the ChipToggle trigger; the panel is a
 * Popover with focus management on, so focus moves into it on open and back to the
 * chip when it closes with focus inside.
 */
export function HeaderMenu({ icon, label, compact = false, ariaLabel, title, className, children }: HeaderMenuProps) {
    const [open, setOpen] = useState(false)
    const anchorRef = useRef<HTMLDivElement>(null)
    const close = useCallback(() => setOpen(false), [])

    return (
        <div ref={anchorRef} className="relative shrink-0">
            <ChipToggle active={open} onClick={() => setOpen((o) => !o)} ariaLabel={ariaLabel}>
                <span className="inline-flex items-center gap-1.5">
                    <Icon name={icon} size={14} />
                    {!compact && label}
                </span>
            </ChipToggle>
            {open && (
                <Popover
                    ariaLabel={ariaLabel}
                    title={title}
                    anchorRef={anchorRef}
                    onDismiss={close}
                    manageFocus
                    className={`right-0 top-[calc(100%+0.5rem)]${className ? ` ${className}` : ''}`}>
                    {typeof children === 'function' ? children({ close }) : children}
                </Popover>
            )}
        </div>
    )
}
