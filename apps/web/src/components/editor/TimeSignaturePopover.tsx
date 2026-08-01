'use client'

import { getGlyphWidth, getYForLine, Glyph } from '@mushee/notation/components'
import { useEffect, useRef } from 'react'

import { Eyebrow } from '@/components/ui'

// Common meters: quarter/half-based on top, eighth-based below.
const TIME_SIGNATURE_ROWS: Array<Array<[number, number]>> = [
    [
        [2, 2],
        [2, 4],
        [3, 4],
        [4, 4],
        [5, 4],
    ],
    [
        [3, 8],
        [6, 8],
        [7, 8],
        [9, 8],
        [12, 8],
    ],
]

/** Stacked meter digits (e.g. 6 over 8) drawn in staff coordinates. */
export function TimeSignatureGlyph({
    beatAmount,
    beatType,
    size = 30,
    color = 'currentColor',
}: {
    beatAmount: number
    beatType: number
    size?: number
    color?: string
}) {
    const rows = [
        { digits: String(beatAmount).split(''), y: getYForLine(1) },
        { digits: String(beatType).split(''), y: getYForLine(3) },
    ].map((row) => ({ ...row, width: row.digits.reduce((total, digit) => total + getGlyphWidth(`timeSig${digit}`), 0) }))
    const width = Math.max(...rows.map((row) => row.width)) + 4
    // Window over the staff band: the digits sit on lines 1 and 3, each spanning a space up and down.
    const top = getYForLine(0) - 2
    const height = getYForLine(4) + 2 - top
    return (
        <svg width={(size * width) / height} height={size} viewBox={`0 ${top} ${width} ${height}`} aria-hidden>
            {rows.map((row, rowIndex) => {
                let x = (width - row.width) / 2
                return row.digits.map((digit, i) => {
                    const glyph = <Glyph key={`${rowIndex}-${i}`} name={`timeSig${digit}`} x={x} y={row.y} fill={color} />
                    x += getGlyphWidth(`timeSig${digit}`)
                    return glyph
                })
            })}
        </svg>
    )
}

interface TimeSignaturePopoverProps {
    active: { beatAmount: number; beatType: number }
    onSelect: (beatAmount: number, beatType: number) => void
    onDismiss: () => void
    /** Extra positioning/layout classes (e.g. `right-0 top-full`). */
    className?: string
    /** Trigger element to exclude from outside-click dismissal, so its toggle isn't fought by the popover. */
    anchorRef?: { current: HTMLElement | null }
}

export function TimeSignaturePopover({ active, onSelect, onDismiss, className, anchorRef }: TimeSignaturePopoverProps) {
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
            aria-label="Select time signature"
            className={`glass-panel tonal-layer-glow absolute z-50 w-max flex flex-col gap-2 p-4 rounded-lg${className ? ` ${className}` : ''}`}
            onMouseDown={(e) => e.stopPropagation()}>
            <Eyebrow>Time signature</Eyebrow>
            <div role="group" aria-label="Time signature" className="flex flex-col gap-1.5">
                {TIME_SIGNATURE_ROWS.map((row, i) => (
                    <div key={i} className="flex flex-wrap gap-1.5">
                        {row.map(([beatAmount, beatType]) => {
                            const isActive = beatAmount === active.beatAmount && beatType === active.beatType
                            return (
                                <button
                                    key={`${beatAmount}/${beatType}`}
                                    type="button"
                                    aria-pressed={isActive}
                                    aria-label={`Set ${beatAmount}/${beatType} time`}
                                    title={`${beatAmount}/${beatType}`}
                                    onClick={() => onSelect(beatAmount, beatType)}
                                    className={[
                                        'flex items-center justify-center w-11 h-12 rounded-md cursor-pointer border-0 shrink-0',
                                        'transition-[background-color,color] duration-150 ease-solkey',
                                        isActive
                                            ? 'bg-primary-container text-on-primary-container'
                                            : 'bg-surface-container-low text-on-surface hover:bg-surface-container',
                                    ].join(' ')}>
                                    <TimeSignatureGlyph beatAmount={beatAmount} beatType={beatType} size={30} />
                                </button>
                            )
                        })}
                    </div>
                ))}
            </div>
        </div>
    )
}
