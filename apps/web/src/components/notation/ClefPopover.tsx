'use client'

import { useEffect, useRef } from 'react'

import { Eyebrow } from '../ui'
import { CLEF_CONFIG, CLEF_DEFS, clefOctaveMarker } from './constants'
import { Glyph } from './Glyph'
import { getGlyphWidth } from './glyph-utils'
import { getYForLine } from './note-utils'
import type { ClefType } from './types'

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
    const popRef = useRef<HTMLDivElement>(null)

    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                e.preventDefault()
                onDismiss()
            }
            e.stopPropagation()
        }
        window.addEventListener('keydown', onKey)
        return () => window.removeEventListener('keydown', onKey)
    }, [onDismiss])

    useEffect(() => {
        const onMouseDown = (e: MouseEvent) => {
            const target = e.target as Node
            if (popRef.current && !popRef.current.contains(target) && !anchorRef?.current?.contains(target)) onDismiss()
        }
        const t = setTimeout(() => document.addEventListener('mousedown', onMouseDown), 0)
        return () => {
            clearTimeout(t)
            document.removeEventListener('mousedown', onMouseDown)
        }
    }, [onDismiss, anchorRef])

    return (
        <div
            ref={popRef}
            role="dialog"
            aria-label="Select clef"
            className={`glass-panel tonal-layer-glow absolute z-50 flex flex-col gap-2 p-4 rounded-lg${className ? ` ${className}` : ''}`}
            onMouseDown={(e) => e.stopPropagation()}>
            <Eyebrow>Clef</Eyebrow>
            <div role="group" aria-label="Clef" className="flex flex-col gap-1.5">
                {CLEF_FAMILIES.map((family, i) => (
                    <div key={i} className="flex gap-1.5">
                        {family.map((type) => {
                            const isActive = type === active
                            return (
                                <button
                                    key={type}
                                    type="button"
                                    aria-pressed={isActive}
                                    aria-label={`Set ${CLEF_DEFS[type].label} clef`}
                                    title={CLEF_DEFS[type].label}
                                    onClick={() => onSelect(type)}
                                    className={[
                                        'flex items-center justify-center w-11 h-11 rounded-md cursor-pointer border-0 shrink-0',
                                        'transition-[background-color,color] duration-150 ease-sheemu',
                                        isActive
                                            ? 'bg-primary-container text-on-primary-container'
                                            : 'bg-surface-container-low text-on-surface hover:bg-surface-container',
                                    ].join(' ')}>
                                    <ClefGlyph type={type} size={34} />
                                </button>
                            )
                        })}
                    </div>
                ))}
            </div>
        </div>
    )
}
