'use client'

import { BeatUnitIcon } from '@mushee/notation/components'
import type { TimeSignature } from '@mushee/notation/model'
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { UnitNumberField } from '@/components/editor/UnitNumberField'
import { Popover, PrimaryButton } from '@/components/ui'

interface TempoPopoverProps {
    /** The tempo in effect, in the model's quarter-note bpm. */
    initialBpm: number
    /** The meter the tempo is written in: it decides the beat the user taps and the note in the mark (♩. in 6/8). */
    timeSignature: TimeSignature
    /** Receives the chosen tempo converted back to quarter-note bpm. */
    onSubmit: (bpm: number) => void
    onDismiss: () => void
    /** Extra positioning/layout classes (e.g. `right-0 top-full`); ignored by a sheet, which its host positions. */
    className?: string
    /** Trigger element to exclude from outside-click dismissal, so its toggle isn't fought by the popover. */
    anchorRef?: { current: HTMLElement | null }
    /** `sheet` on phones: the full-width sheet above the dock (see Popover). */
    variant?: 'anchored' | 'sheet'
    /** Rendered above the controls — the More sheet's Back link. */
    lead?: ReactNode
}

const MIN_BPM = 20
const MAX_BPM = 300
const TAP_RESET_MS = 2000
const TAP_WINDOW = 8

const COUNT_WORDS = ['', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve']

/** How many beats a bar holds, in words: "two per bar in 6/8". */
function beatsPerBarLabel(timeSignature: TimeSignature): string {
    const count = timeSignature.pulsesPerMeasure
    return `${COUNT_WORDS[count] ?? count} per bar in ${timeSignature.beatAmount}/${timeSignature.beatType}`
}

/** The tap pad's corner readout: what to do until a tempo emerges, then where it came from. */
export function tapReadout(tappedBpm: number | null, taps: number): string {
    return tappedBpm === null ? 'Tap at least twice' : `${tappedBpm} bpm from ${taps} taps`
}

export function TempoPopover({
    initialBpm,
    timeSignature,
    onSubmit,
    onDismiss,
    className,
    anchorRef,
    variant = 'anchored',
    lead,
}: TempoPopoverProps) {
    const inputRef = useRef<HTMLInputElement>(null)
    const [taps, setTaps] = useState<number[]>([])
    const [draft, setDraft] = useState(String(Math.round(timeSignature.pulseBpmOf(initialBpm))))
    const [pulse, setPulse] = useState(0)
    const beat = timeSignature.pulse
    const sheet = variant === 'sheet'

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

    // Announced as it changes (politely), and never part of the tap pad's name.
    const readout = (
        <span aria-live="polite" className="font-mono font-medium text-[11px] leading-none text-on-surface-variant">
            {tapReadout(tappedBpm, taps.length)}
        </span>
    )

    return (
        <Popover
            ariaLabel="Set tempo"
            title="Tempo"
            hint="How fast the beat goes — 60 is slow, 120 is lively."
            onDismiss={onDismiss}
            onKeyDown={handleKey}
            anchorRef={anchorRef}
            variant={variant}
            className={sheet ? 'gap-3' : `w-90 gap-3${className ? ` ${className}` : ''}`}
            // A sheet's heading row is narrow on a phone: there the readout sits in the tap pad's
            // corner instead — laid over it, outside the button, so the pad's name stays put.
            headerRight={sheet ? undefined : readout}>
            {lead}
            <div className="relative">
                <button
                    type="button"
                    onClick={handleTap}
                    className="relative overflow-hidden w-full flex flex-col gap-1.5 px-4 py-5.5 rounded-md text-left cursor-pointer border-0 bg-primary-soft text-on-primary-soft focus-ring">
                    <span className="flex items-center gap-2 font-label font-semibold text-[11px] leading-none uppercase tracking-[0.14em] text-on-surface-variant">
                        <span
                            className="block w-2 h-2 rounded-full bg-primary-container transition-transform duration-120 ease-solkey"
                            style={{ transform: `scale(${1 + (pulse % 2) * 0.6})` }}
                        />
                        Tap along
                    </span>
                    <span className="font-body font-medium text-[15px] leading-[1.3]">
                        {/* Phones have no spacebar: each pointer gets the instruction it can follow. */}
                        <span className="pointer-coarse:hidden">Click here or press the spacebar on every beat</span>
                        <span className="hidden pointer-coarse:inline">Tap here on every beat</span>
                        {(timeSignature.isCompound || timeSignature.beatType !== 4) && (
                            <span className="block text-on-surface-variant">{beatsPerBarLabel(timeSignature)}</span>
                        )}
                    </span>
                </button>
                {sheet && <span className="pointer-events-none absolute top-5.5 right-4 flex">{readout}</span>}
            </div>

            <div className="flex items-stretch gap-2">
                <UnitNumberField
                    inputRef={inputRef}
                    value={draft}
                    onChange={setDraft}
                    ariaLabel="Tempo (bpm)"
                    unit="bpm"
                    unitDescription="beats per minute"
                    min={MIN_BPM}
                    max={MAX_BPM}
                    size="md"
                    className="flex-1"
                    leading={
                        <>
                            <BeatUnitIcon duration={beat} size={20} />
                            <span className="font-body font-medium text-[16px] leading-none">=</span>
                        </>
                    }
                />
                <PrimaryButton onClick={commit}>Set tempo</PrimaryButton>
            </div>
        </Popover>
    )
}
