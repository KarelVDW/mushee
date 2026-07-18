'use client'

import { useEffect, useRef } from 'react'

import { KeySignature } from '@/model/KeySignature'
import { Pitch } from '@/model/Pitch'

import { Eyebrow } from '../ui'
import { Glyph } from './Glyph'
import { getYForNote } from './noteUtils'

// Key signatures grouped flats → C → sharps, each labelled by its major key.
const KEY_ROWS: number[][] = [
    [-7, -6, -5, -4, -3, -2, -1],
    [0],
    [1, 2, 3, 4, 5, 6, 7],
]

const KEY_NAMES: Record<number, string> = {
    [-7]: 'C♭',
    [-6]: 'G♭',
    [-5]: 'D♭',
    [-4]: 'A♭',
    [-3]: 'E♭',
    [-2]: 'B♭',
    [-1]: 'F',
    0: 'C',
    1: 'G',
    2: 'D',
    3: 'A',
    4: 'E',
    5: 'B',
    6: 'F♯',
    7: 'C♯',
}

/** Compact label for a key signature, e.g. "♮", "2♯", "3♭". */
export function keySignatureLabel(fifths: number): string {
    if (fifths === 0) return '♮'
    return fifths > 0 ? `${fifths}♯` : `${-fifths}♭`
}

const STAFF_TOP = 10
const STAFF_VIEW_HEIGHT = 92
const GLYPH_ADVANCE = 7

/** The run of sharps/flats for a key, drawn on a mini treble staff (used in the control and picker). */
export function KeySignatureGlyph({ fifths, size = 30, color = 'currentColor' }: { fifths: number; size?: number; color?: string }) {
    const accidentals = KeySignature.accidentalsForFifths(fifths)
    if (accidentals.length === 0) return <span style={{ fontSize: size * 0.5, lineHeight: 1, color }}>♮</span>
    const viewWidth = accidentals.length * GLYPH_ADVANCE + 4
    return (
        <svg width={(size * viewWidth) / STAFF_VIEW_HEIGHT} height={size} viewBox={`0 ${STAFF_TOP} ${viewWidth} ${STAFF_VIEW_HEIGHT}`} aria-hidden>
            {accidentals.map((a, i) => (
                <Glyph key={i} name={a.glyphName} x={2 + i * GLYPH_ADVANCE} y={getYForNote(new Pitch({ name: a.name, octave: a.octave }).line)} fill={color} />
            ))}
        </svg>
    )
}

interface KeySignaturePopoverProps {
    active: number
    onSelect: (fifths: number) => void
    onDismiss: () => void
    /** Extra positioning/layout classes (e.g. `right-0 top-full`). */
    className?: string
    /** Trigger element to exclude from outside-click dismissal, so its toggle isn't fought by the popover. */
    anchorRef?: { current: HTMLElement | null }
}

export function KeySignaturePopover({ active, onSelect, onDismiss, className, anchorRef }: KeySignaturePopoverProps) {
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
            aria-label="Select key signature"
            className={`glass-panel tonal-layer-glow absolute z-50 flex flex-col gap-2 p-4 rounded-lg${className ? ` ${className}` : ''}`}
            onMouseDown={(e) => e.stopPropagation()}>
            <Eyebrow>Key signature</Eyebrow>
            <div role="group" aria-label="Key signature" className="flex flex-col gap-1.5 items-center">
                {KEY_ROWS.map((row, i) => (
                    <div key={i} className="flex flex-wrap justify-center gap-1.5">
                        {row.map((fifths) => {
                            const isActive = fifths === active
                            return (
                                <button
                                    key={fifths}
                                    type="button"
                                    aria-pressed={isActive}
                                    aria-label={`${KEY_NAMES[fifths]} major`}
                                    title={`${KEY_NAMES[fifths]} major`}
                                    onClick={() => onSelect(fifths)}
                                    className={[
                                        'flex flex-col items-center justify-end gap-0.5 w-12 h-14 rounded-md cursor-pointer border-0 shrink-0 px-1 py-1.5',
                                        'transition-[background-color,color] duration-150 ease-solkey',
                                        isActive
                                            ? 'bg-primary-container text-on-primary-container'
                                            : 'bg-surface-container-low text-on-surface hover:bg-surface-container',
                                    ].join(' ')}>
                                    <span className="flex flex-1 items-center">
                                        <KeySignatureGlyph fifths={fifths} size={32} />
                                    </span>
                                    <span className="text-[11px] leading-none font-medium">{KEY_NAMES[fifths]}</span>
                                </button>
                            )
                        })}
                    </div>
                ))}
            </div>
        </div>
    )
}
