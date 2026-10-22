'use client'

import { ClefIcon } from '@mushee/notation/components'
import { CLEF_DEFS, type ClefType } from '@mushee/notation/model'

import { Popover, PopoverOption } from '@/components/ui'

// Clefs grouped into rows by sign family (G / C / F), matching how engravers present them.
const CLEF_FAMILIES: ClefType[][] = [
    ['treble', 'treble8va', 'treble8vb', 'treble15ma', 'treble15mb'],
    ['soprano', 'mezzoSoprano', 'alto', 'tenor', 'baritoneC'],
    ['baritoneF', 'bass', 'bass8va', 'bass8vb', 'bass15ma', 'bass15mb', 'subBass'],
]

interface ClefPopoverProps {
    active: ClefType
    onSelect: (type: ClefType) => void
    onDismiss: () => void
    /** Extra positioning/layout classes (e.g. `right-0 top-full`). */
    className?: string
    /** Trigger element to exclude from outside-click dismissal, so its toggle isn't fought by the popover. */
    anchorRef?: { current: HTMLElement | null }
}

export function ClefPopover({ active, onSelect, onDismiss, className, anchorRef }: ClefPopoverProps) {
    return (
        <Popover
            ariaLabel="Select clef"
            title="Clef"
            onDismiss={onDismiss}
            anchorRef={anchorRef}
            className={`w-max gap-2${className ? ` ${className}` : ''}`}>
            <div role="group" aria-label="Clef" className="flex flex-col gap-1.5">
                {CLEF_FAMILIES.map((family, i) => (
                    <div key={i} className="flex flex-wrap gap-1.5">
                        {family.map((type) => (
                            <PopoverOption
                                key={type}
                                active={type === active}
                                ariaLabel={`Set ${CLEF_DEFS[type].label} clef`}
                                title={CLEF_DEFS[type].label}
                                onClick={() => onSelect(type)}
                                className="justify-center w-11 h-11">
                                <ClefIcon type={type} size={34} />
                            </PopoverOption>
                        ))}
                    </div>
                ))}
            </div>
        </Popover>
    )
}
