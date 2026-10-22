'use client'

import { ClefIcon } from '@mushee/notation/components'
import { CLEF_DEFS, type ClefType } from '@mushee/notation/model'
import { type ReactNode, useState } from 'react'

import { Popover, PopoverOption, TertiaryButton } from '@/components/ui'

/** The two clefs almost everyone wants, each with a plain line on what it is for. */
const MAIN_CLEFS: { type: ClefType; hint?: string }[] = [
    { type: 'treble', hint: 'Higher voices and instruments' },
    { type: 'bass', hint: 'Lower voices and instruments' },
]

// The rest, grouped by sign family (G / C / F), as engravers present them.
const CLEF_FAMILIES: ClefType[] = [
    'treble8va',
    'treble8vb',
    'treble15ma',
    'treble15mb',
    'soprano',
    'mezzoSoprano',
    'alto',
    'tenor',
    'baritoneC',
    'baritoneF',
    'bass8va',
    'bass8vb',
    'bass15ma',
    'bass15mb',
    'subBass',
]

interface ClefPopoverProps {
    active: ClefType
    onSelect: (type: ClefType) => void
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
 * The clef picker: Treble and Bass as labelled rows first — plus the clef in use, when it is
 * neither, so it never hides — and every other clef behind "More clefs", each captioned with
 * its name. A clef is listed once, so its "Set … clef" name is unique in the panel.
 */
export function ClefPopover({ active, onSelect, onDismiss, className, anchorRef, variant = 'anchored', lead }: ClefPopoverProps) {
    const [expanded, setExpanded] = useState(false)
    const sheet = variant === 'sheet'
    const activeIsMain = MAIN_CLEFS.some((clef) => clef.type === active)
    const leading = activeIsMain ? MAIN_CLEFS : [...MAIN_CLEFS, { type: active }]
    const rest = CLEF_FAMILIES.filter((type) => type !== active)

    return (
        <Popover
            ariaLabel="Select clef"
            title="Clef"
            hint="Treble for higher notes, bass for lower ones."
            onDismiss={onDismiss}
            anchorRef={anchorRef}
            variant={variant}
            className={sheet ? 'gap-2' : `w-80 gap-2${className ? ` ${className}` : ''}`}>
            {lead}
            <div role="group" aria-label="Clef" className="flex flex-col gap-1.5">
                {leading.map(({ type, hint }) => (
                    <PopoverOption
                        key={type}
                        active={type === active}
                        ariaLabel={`Set ${CLEF_DEFS[type].label} clef`}
                        onClick={() => onSelect(type)}
                        className="w-full h-14 gap-3 px-3 text-left">
                        <span className="flex w-8 justify-center">
                            <ClefIcon type={type} size={34} />
                        </span>
                        <span className="flex flex-col gap-0.5">
                            <span className="font-label font-semibold text-[14px] leading-tight">{CLEF_DEFS[type].label}</span>
                            {hint && <span className="font-body text-[12px] leading-tight opacity-80">{hint}</span>}
                        </span>
                    </PopoverOption>
                ))}
                {expanded && (
                    <div className="flex flex-wrap gap-1.5 pt-1">
                        {rest.map((type) => (
                            <PopoverOption
                                key={type}
                                active={false}
                                ariaLabel={`Set ${CLEF_DEFS[type].label} clef`}
                                onClick={() => onSelect(type)}
                                className="flex-col justify-center gap-1 w-23 h-19 px-1">
                                <ClefIcon type={type} size={30} />
                                <span className="font-label font-medium text-[11px] leading-tight text-center">
                                    {CLEF_DEFS[type].label}
                                </span>
                            </PopoverOption>
                        ))}
                    </div>
                )}
            </div>
            {!expanded && (
                <div>
                    <TertiaryButton onClick={() => setExpanded(true)}>More clefs</TertiaryButton>
                </div>
            )}
        </Popover>
    )
}
