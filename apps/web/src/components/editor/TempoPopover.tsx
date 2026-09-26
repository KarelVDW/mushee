'use client'

import { BeatUnit, beatUnitWidth } from '@mushee/notation/components'
import type { Duration, TimeSignature } from '@mushee/notation/model'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { Popover, PrimaryButton } from '@/components/ui'

interface TempoPopoverProps {
    /** The tempo in effect, in the model's quarter-note bpm. */
    initialBpm: number
    /** The meter the tempo is written in: it decides the beat the user taps and the note in the mark (♩. in 6/8). */
    timeSignature: TimeSignature
    /** Receives the chosen tempo converted back to quarter-note bpm. */
    onSubmit: (bpm: number) => void
    onDismiss: () => void
    /** Absolute position within the nearest positioned ancestor. Omit to position via `className` instead. */
    x?: number
    y?: number
    /** Extra positioning/layout classes (e.g. `right-0 top-full`) when not using `x`/`y`. */
    className?: string
    /** Trigger element to exclude from outside-click dismissal, so its toggle isn't fought by the popover. */
    anchorRef?: { current: HTMLElement | null }
}

const MIN_BPM = 20
const MAX_BPM = 300
const TAP_RESET_MS = 2000
const TAP_WINDOW = 8

const COUNT_WORDS = ['', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve']

/** The note of a metronome mark (♩, ♩., 𝅗𝅥) as an inline icon, sized by its height. */
export function BeatUnitIcon({ duration, size = 18, color = 'currentColor' }: { duration: Duration; size?: number; color?: string }) {
    // The glyph sits with its notehead centre on y = 0: the stem reaches 14 up, the head 5 down.
    const top = -17
    const height = 24
    const width = beatUnitWidth(duration) + 2
    return (
        <svg width={(size * width) / height} height={size} viewBox={`-1 ${top} ${width} ${height}`} aria-hidden>
            <BeatUnit duration={duration} fill={color} />
        </svg>
    )
}

/** How many beats a bar holds, in words: "two per bar in 6/8". */
function beatsPerBarLabel(timeSignature: TimeSignature): string {
    const count = timeSignature.pulsesPerMeasure
    return `${COUNT_WORDS[count] ?? count} per bar in ${timeSignature.beatAmount}/${timeSignature.beatType}`
}

export function TempoPopover({ x, y, initialBpm, timeSignature, onSubmit, onDismiss, className, anchorRef }: TempoPopoverProps) {
    const inputRef = useRef<HTMLInputElement>(null)
    const [taps, setTaps] = useState<number[]>([])
    const [draft, setDraft] = useState(String(Math.round(timeSignature.pulseBpmOf(initialBpm))))
    const [pulse, setPulse] = useState(0)
    const beat = timeSignature.pulse

    // Taps are one per felt beat — a dotted quarter in 6/8 — so the tapped bpm is already in the written unit.
    const tappedBpm = useMemo(() => {
        if (taps.length < 2) return null
        const intervals: number[] = []
        for (let i = 1; i < taps.length; i++) intervals.push(taps[i] - taps[i - 1])
        const avg = intervals.reduce((a, b) => a + b, 0) / intervals.length
        return Math.round(60000 / avg)
    }, [taps])

    const handleTap = useCallback(() => {
        const now = performance.now()
        setTaps((prev) => {
            const last = prev[prev.length - 1]
            return last && now - last > TAP_RESET_MS ? [now] : [...prev, now].slice(-TAP_WINDOW)
        })
        setPulse((p) => p + 1)
    }, [])

    const commit = useCallback(() => {
        const n = parseInt(draft, 10)
        if (n && n >= MIN_BPM && n <= MAX_BPM) onSubmit(timeSignature.quarterBpmOf(n))
    }, [draft, onSubmit, timeSignature])

    const handleKey = useCallback(
        (e: KeyboardEvent) => {
            if (e.code === 'Space' && document.activeElement !== inputRef.current) {
                e.preventDefault()
                handleTap()
            } else if (e.key === 'Enter' && document.activeElement === inputRef.current) {
                e.preventDefault()
                commit()
            }
        },
        [handleTap, commit],
    )

    useEffect(() => {
        if (tappedBpm) setDraft(String(tappedBpm))
    }, [tappedBpm])

    return (
        <Popover
            ariaLabel="Set tempo"
            title="Tempo"
            onDismiss={onDismiss}
            onKeyDown={handleKey}
            x={x}
            y={y}
            anchorRef={anchorRef}
            className={`w-90 gap-3${className ? ` ${className}` : ''}`}
            headerRight={
                <span className="font-mono font-medium text-[11px] leading-none text-on-surface-variant">
                    {taps.length < 2 ? 'Tap 2+ times' : `${tappedBpm} bpm · ${taps.length} taps`}
                </span>
            }>
            <button
                type="button"
                onClick={handleTap}
                className="relative overflow-hidden flex flex-col gap-1.5 px-4 py-5.5 rounded-md text-left cursor-pointer border-0 bg-primary-soft text-on-primary-soft">
                <span className="flex items-center gap-2 font-label font-semibold text-[11px] leading-none uppercase tracking-[0.14em] text-on-surface-variant">
                    <span
                        className="block w-2 h-2 rounded-full bg-primary-container transition-transform duration-120 ease-solkey"
                        style={{ transform: `scale(${1 + (pulse % 2) * 0.6})` }}
                    />
                    Tap along
                </span>
                <span className="font-body font-medium text-[15px] leading-[1.3]">
                    Click or tap the spacebar on{' '}
                    <span className="whitespace-nowrap">
                        every <BeatUnitIcon duration={beat} size={17} color="currentColor" />
                    </span>
                    <span className="sr-only">{beat.name} beat</span>
                    {(timeSignature.isCompound || timeSignature.beatType !== 4) && (
                        <span className="block text-on-surface-variant">{beatsPerBarLabel(timeSignature)}</span>
                    )}
                </span>
            </button>

            <div className="flex items-stretch gap-2">
                <div className="relative flex-1 flex items-center gap-2 px-3 rounded-sm bg-surface-container-low">
                    <span className="flex items-center gap-1.5 text-on-surface" aria-hidden>
                        <BeatUnitIcon duration={beat} size={20} />
                        <span className="font-body font-medium text-[16px] leading-none">=</span>
                    </span>
                    <input
                        ref={inputRef}
                        type="number"
                        min={MIN_BPM}
                        max={MAX_BPM}
                        value={draft}
                        onChange={(e) => setDraft(e.target.value)}
                        aria-label="BPM"
                        className="flex-1 min-w-0 py-3 bg-transparent border-0 outline-0 font-body font-medium text-[16px] leading-none text-on-surface [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                    />
                    <span className="font-label font-medium text-[11px] leading-none uppercase tracking-[0.12em] text-on-surface-variant">
                        bpm
                    </span>
                    <div className="absolute left-0 right-0 bottom-0 h-0.5 bg-primary-container" />
                </div>
                <PrimaryButton onClick={commit}>Set</PrimaryButton>
            </div>
        </Popover>
    )
}
