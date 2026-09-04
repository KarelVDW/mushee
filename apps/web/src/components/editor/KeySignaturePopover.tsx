'use client'

import { Glyph } from '@mushee/notation/components'
import { getYForNote } from '@mushee/notation/components/noteUtils'
import { KeySignature } from '@mushee/notation/model/KeySignature'
import { Pitch } from '@mushee/notation/model/Pitch'

import { Popover, PopoverOption } from '@/components/ui'

// Key signatures grouped flats → C → sharps, each labelled by its major key.
const KEY_ROWS: number[][] = [[-7, -6, -5, -4, -3, -2, -1], [0], [1, 2, 3, 4, 5, 6, 7]]

export const KEY_NAMES: Record<number, string> = {
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
        <svg
            width={(size * viewWidth) / STAFF_VIEW_HEIGHT}
            height={size}
            viewBox={`0 ${STAFF_TOP} ${viewWidth} ${STAFF_VIEW_HEIGHT}`}
            aria-hidden>
            {accidentals.map((a, i) => (
                <Glyph
                    key={i}
                    name={a.glyphName}
                    x={2 + i * GLYPH_ADVANCE}
                    y={getYForNote(new Pitch({ name: a.name, octave: a.octave }).line)}
                    fill={color}
                />
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
    return (
        <Popover
            ariaLabel="Select key signature"
            title="Key signature"
            onDismiss={onDismiss}
            anchorRef={anchorRef}
            className={`w-max gap-2${className ? ` ${className}` : ''}`}>
            <div role="group" aria-label="Key signature" className="flex flex-col gap-1.5 items-center">
                {KEY_ROWS.map((row, i) => (
                    <div key={i} className="flex flex-wrap justify-center gap-1.5">
                        {row.map((fifths) => (
                            <PopoverOption
                                key={fifths}
                                active={fifths === active}
                                ariaLabel={`${KEY_NAMES[fifths]} major`}
                                title={`${KEY_NAMES[fifths]} major`}
                                onClick={() => onSelect(fifths)}
                                className="flex-col justify-end gap-0.5 w-12 h-14 px-1 py-1.5">
                                <span className="flex flex-1 items-center">
                                    <KeySignatureGlyph fifths={fifths} size={32} />
                                </span>
                                <span className="text-[11px] leading-none font-medium">{KEY_NAMES[fifths]}</span>
                            </PopoverOption>
                        ))}
                    </div>
                ))}
            </div>
        </Popover>
    )
}
