'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { Eyebrow, PrimaryButton } from '../ui'

interface TempoPopoverProps {
    initialBpm: number
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

export function TempoPopover({ x, y, initialBpm, onSubmit, onDismiss, className, anchorRef }: TempoPopoverProps) {
    const popRef = useRef<HTMLDivElement>(null)
    const inputRef = useRef<HTMLInputElement>(null)
    const [taps, setTaps] = useState<number[]>([])
    const [draft, setDraft] = useState(String(initialBpm))
    const [pulse, setPulse] = useState(0)

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
        if (n && n >= MIN_BPM && n <= MAX_BPM) onSubmit(n)
    }, [draft, onSubmit])

    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (e.code === 'Space' && document.activeElement !== inputRef.current) {
                e.preventDefault()
                handleTap()
            } else if (e.key === 'Escape') {
                e.preventDefault()
                onDismiss()
            } else if (e.key === 'Enter' && document.activeElement === inputRef.current) {
                e.preventDefault()
                commit()
            }
            e.stopPropagation()
        }
        window.addEventListener('keydown', onKey)
        return () => window.removeEventListener('keydown', onKey)
    }, [handleTap, commit, onDismiss])

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

    useEffect(() => {
        if (tappedBpm) setDraft(String(tappedBpm))
    }, [tappedBpm])

    return (
        <div
            ref={popRef}
            role="dialog"
            aria-label="Set tempo"
            style={x !== undefined && y !== undefined ? { left: x, top: y } : undefined}
            className={`glass-panel tonal-layer-glow absolute z-50 w-90 flex flex-col gap-3 p-4 rounded-lg${className ? ` ${className}` : ''}`}
            onMouseDown={(e) => e.stopPropagation()}>
            <div className="flex justify-between items-center">
                <Eyebrow>Tempo</Eyebrow>
                <span className="font-mono font-medium text-[11px] leading-none text-on-surface-variant">
                    {taps.length < 2 ? 'Tap 2+ times' : `${tappedBpm} bpm · ${taps.length} taps`}
                </span>
            </div>

            <button
                type="button"
                onClick={handleTap}
                className="relative overflow-hidden flex flex-col gap-1.5 px-4 py-5.5 rounded-md text-left cursor-pointer border-0 bg-primary-soft text-on-primary-soft">
                <span className="flex items-center gap-2 font-label font-semibold text-[11px] leading-none uppercase tracking-[0.14em] text-on-surface-variant">
                    <span
                        className="block w-2 h-2 rounded-full bg-primary-container transition-transform duration-120 ease-sheemu"
                        style={{ transform: `scale(${1 + (pulse % 2) * 0.6})` }}
                    />
                    Tap along
                </span>
                <span className="font-body font-medium text-[15px] leading-[1.3]">Click or tap the spacebar in tempo</span>
            </button>

            <div className="flex items-stretch gap-2">
                <div className="relative flex-1 flex items-center px-3 rounded-sm bg-surface-container-low">
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
        </div>
    )
}
