'use client'

import type { AttributeClickEvent } from '@mushee/notation/components'
import { TimeSignature } from '@mushee/notation/model'
import { type ReactNode, useEffect, useLayoutEffect, useRef, useState } from 'react'

import { ClefPopover } from '@/components/editor/ClefPopover'
import { KeySignaturePopover } from '@/components/editor/KeySignaturePopover'
import { TempoPopover } from '@/components/editor/TempoPopover'
import { TimeSignaturePopover } from '@/components/editor/TimeSignaturePopover'
import { usePickConfirmation } from '@/components/ui'
import { TOOLTIP_HOVER_DELAY_MS } from '@/components/ui/Tooltip'

import type { ScoreManipulator } from './ScoreManipulator'

/** Meter assumed for the in-score tempo popover when its measure is gone (the score reloaded underneath it). */
const DEFAULT_TIME_SIGNATURE = new TimeSignature(4, 4)

/** Space kept between an anchored attribute popover and the score wrapper's side edges. */
const POPOVER_EDGE_MARGIN = 8
/** How far below the clicked row's bottom staff line the tempo popover opens, so the bar stays in view. */
const TEMPO_BELOW_STAFF = 16
/** A clef / key / time popover's gap under the staff top it was clicked at. */
const GLYPH_POPOVER_DROP = 40
/** The hover label's gap above the glyph it names. */
const HOVER_TIP_GAP = 8

/** What a click on each in-score glyph lets you do — its hover label. */
const CHANGE_LABEL: Record<AttributeClickEvent['kind'], string> = {
    clef: 'Change clef',
    key: 'Change key',
    time: 'Change time signature',
    tempo: 'Change tempo',
}

interface ScoreAttributePopoverProps {
    /** The attribute glyph click the ScoreView reported. */
    event: AttributeClickEvent
    manipulator: ScoreManipulator
    /**
     * `anchored` (desktop): at the clicked glyph, clamped inside the score wrapper — below the
     * row for a tempo mark, so the bar being edited stays visible. `sheet` (mobile): the same
     * sheet above the dock that the More sheet's pickers use, rendered through the editor's
     * one sheet host — anchored panels clip at the viewport edge.
     */
    placement: 'anchored' | 'sheet'
    onClose: () => void
}

/**
 * The popover an in-score attribute glyph (tempo / clef / key / time) opens. The ScoreView
 * only reports the click; this picks the matching popover and applies the change through the
 * manipulator's positional setters. The admin console renders the same ScoreView with no
 * callbacks — that's what keeps its score page read-only.
 */
export function ScoreAttributePopover({ event, manipulator, placement, onClose }: ScoreAttributePopoverProps) {
    if (placement === 'sheet') return <AttributePopoverPanel event={event} manipulator={manipulator} variant="sheet" onClose={onClose} />
    const y = event.kind === 'tempo' ? event.staffBottom + TEMPO_BELOW_STAFF : event.y + GLYPH_POPOVER_DROP
    return (
        <AttributePopoverAnchor x={event.x} y={y}>
            <AttributePopoverPanel event={event} manipulator={manipulator} variant="anchored" onClose={onClose} />
        </AttributePopoverAnchor>
    )
}

/** The popover matching the clicked glyph's kind; every choice applies, then closes it (a sheet shows the pick first). */
function AttributePopoverPanel({
    event,
    manipulator,
    variant,
    onClose,
}: {
    event: AttributeClickEvent
    manipulator: ScoreManipulator
    variant: 'anchored' | 'sheet'
    onClose: () => void
}) {
    const closeAfterPick = usePickConfirmation(onClose, variant === 'sheet')
    const className = variant === 'anchored' ? 'left-0 top-0' : undefined
    switch (event.kind) {
        case 'tempo':
            return (
                <TempoPopover
                    variant={variant}
                    className={className}
                    initialBpm={event.bpm}
                    timeSignature={manipulator.score?.measures[event.measureIndex]?.timeSignature ?? DEFAULT_TIME_SIGNATURE}
                    onSubmit={(bpm) => {
                        manipulator.setTempoAt(event.measureIndex, event.beatPosition, bpm)
                        onClose()
                    }}
                    onDismiss={onClose}
                />
            )
        case 'clef':
            return (
                <ClefPopover
                    variant={variant}
                    active={event.clef}
                    className={className}
                    onSelect={(type) => {
                        manipulator.setClefAt(event.measureIndex, type)
                        closeAfterPick()
                    }}
                    onDismiss={onClose}
                />
            )
        case 'key':
            return (
                <KeySignaturePopover
                    variant={variant}
                    active={event.fifths}
                    className={className}
                    onSelect={(fifths) => {
                        manipulator.setKeyAt(event.measureIndex, fifths)
                        closeAfterPick()
                    }}
                    onDismiss={onClose}
                />
            )
        case 'time':
            return (
                <TimeSignaturePopover
                    variant={variant}
                    active={{ beatAmount: event.beatAmount, beatType: event.beatType }}
                    className={className}
                    onSelect={(beatAmount, beatType) => {
                        manipulator.setTimeSignatureAt(event.measureIndex, beatAmount, beatType)
                        closeAfterPick()
                    }}
                    onDismiss={onClose}
                />
            )
    }
}

/**
 * Positions an in-score attribute popover at the clicked glyph, pulled left just enough to
 * stay inside the score wrapper (its offsetParent) — the same measure-and-clamp approach as
 * SelectionPopover. Re-measured every render: the panel's width depends on which popover is
 * inside, and there is no ResizeObserver.
 */
function AttributePopoverAnchor({ x, y, children }: { x: number; y: number; children: ReactNode }) {
    const ref = useRef<HTMLDivElement>(null)
    const [left, setLeft] = useState<number | null>(null)
    useLayoutEffect(() => {
        const el = ref.current
        const parent = el?.offsetParent as HTMLElement | null
        // Measure the popover panel, not the anchor: the panel is absolutely positioned
        // inside it, so the anchor itself has no size.
        const panel = el?.firstElementChild as HTMLElement | null
        if (!el || !parent || !panel) return
        setLeft(Math.min(x, Math.max(POPOVER_EDGE_MARGIN, parent.clientWidth - panel.offsetWidth - POPOVER_EDGE_MARGIN)))
    })
    return (
        <div
            ref={ref}
            className="absolute z-(--z-popover)"
            style={{ left: left ?? x, top: y, visibility: left === null ? 'hidden' : undefined }}>
            {children}
        </div>
    )
}

/**
 * The hover label over an in-score clef, key, time signature or tempo mark — "Change key" —
 * so the printed-looking glyphs say they can be clicked. Mouse hover only (the ScoreView
 * reports pen and mouse), after the shared tooltip delay; drawn in the tooltip's opaque card.
 * Decorative for assistive tech: the glyphs aren't focusable, and the dock's chips carry the
 * same controls by name.
 */
export function AttributeHoverTip({ event }: { event: AttributeClickEvent | null }) {
    const [shown, setShown] = useState<AttributeClickEvent | null>(null)
    useEffect(() => {
        if (!event) {
            setShown(null)
            return
        }
        const timer = setTimeout(() => setShown(event), TOOLTIP_HOVER_DELAY_MS)
        return () => clearTimeout(timer)
    }, [event])
    if (!shown) return null
    return (
        <span
            aria-hidden
            className="tooltip-enter absolute z-(--z-popover) pointer-events-none -translate-x-1/2 -translate-y-full w-max rounded-md bg-surface-container-lowest editorial-shadow px-2.5 py-1.5 font-label font-semibold text-[13px] leading-[1.35] text-on-surface"
            style={{ left: shown.x, top: shown.y - HOVER_TIP_GAP }}>
            {CHANGE_LABEL[shown.kind]}
        </span>
    )
}
