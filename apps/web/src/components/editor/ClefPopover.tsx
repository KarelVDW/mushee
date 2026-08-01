'use client'

import { Glyph } from '@mushee/notation/components'
import { CLEF_CONFIG, CLEF_DEFS, clefOctaveMarker } from '@mushee/notation/components/constants'
import { getGlyphWidth } from '@mushee/notation/components/glyphUtils'
import { getYForLine } from '@mushee/notation/components/noteUtils'
import type { ClefType } from '@mushee/notation/components/types'

import { Popover, PopoverOption } from '@/components/ui'

// Clefs grouped into rows by sign family (G / C / F), matching how engravers present them.
const CLEF_FAMILIES: ClefType[][] = [
    ['treble', 'treble8va', 'treble8vb', 'treble15ma', 'treble15mb'],
    ['soprano', 'mezzoSoprano', 'alto', 'tenor', 'baritoneC'],
    ['baritoneF', 'bass', 'bass8va', 'bass8vb', 'bass15ma', 'bass15mb', 'subBass'],
]

/** A clef glyph (with any 8/15 octave marker) drawn in staff coordinates. */
export function ClefGlyph({ type, size = 30, color = 'currentColor' }: { type: ClefType; size?: number; color?: string }) {
    const config = CLEF_CONFIG[type]
    if (!config) return null
    // Window over the staff region (lines sit at y 40–80), padded so taller glyphs and octave markers fit.
    const top = 10
    const height = 92
    const width = 28
    const marker = clefOctaveMarker(type)
    const markerX = 4 + getGlyphWidth(config.glyphName) / 2
    const markerY = marker?.above ? getYForLine(0) - 6 : getYForLine(4) + 13
    return (
        <svg width={(size * width) / height} height={size} viewBox={`0 ${top} ${width} ${height}`} aria-hidden>
            <Glyph name={config.glyphName} x={4} y={getYForLine(config.lineIndex)} fill={color} />
            {marker && (
                <text x={markerX} y={markerY} fontSize={9} fontWeight={600} textAnchor="middle" dominantBaseline="middle" fill={color}>
                    {marker.text}
                </text>
            )}
        </svg>
    )
}

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
                                <ClefGlyph type={type} size={34} />
                            </PopoverOption>
                        ))}
                    </div>
                ))}
            </div>
        </Popover>
    )
}
