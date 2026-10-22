'use client'

import type { AttributeClickEvent } from '@mushee/notation/components'
import { TimeSignature } from '@mushee/notation/model'
import { type ReactNode, useLayoutEffect, useRef, useState } from 'react'

import { ClefPopover } from '@/components/editor/ClefPopover'
import { KeySignaturePopover } from '@/components/editor/KeySignaturePopover'
import { TempoPopover } from '@/components/editor/TempoPopover'
import { TimeSignaturePopover } from '@/components/editor/TimeSignaturePopover'

import { COMPACT_POPOVER_SHEET } from './PopoverChip'
import type { ScoreManipulator } from './ScoreManipulator'

/** Meter assumed for the in-score tempo popover when its measure is gone (the score reloaded underneath it). */
const DEFAULT_TIME_SIGNATURE = new TimeSignature(4, 4)

/** Space kept between an anchored attribute popover and the score wrapper's side edges. */
const POPOVER_EDGE_MARGIN = 8

interface ScoreAttributePopoverProps {
    /** The attribute glyph click the ScoreView reported. */
    event: AttributeClickEvent
    manipulator: ScoreManipulator
    /**
     * `anchored` (desktop): at the clicked glyph, clamped inside the score wrapper. `sheet`
     * (mobile): the same full-width sheet above the dock that the dock's own clef / key /
     * time / tempo chips open — anchored panels clip at the viewport edge.
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
    if (placement === 'sheet') {
        return <AttributePopoverPanel event={event} manipulator={manipulator} className={COMPACT_POPOVER_SHEET} onClose={onClose} />
    }
    return (
        <AttributePopoverAnchor x={event.x} y={event.y + (event.kind === 'tempo' ? -30 : 40)}>
            <AttributePopoverPanel event={event} manipulator={manipulator} className="left-0 top-0" onClose={onClose} />
        </AttributePopoverAnchor>
    )
}

/** The popover matching the clicked glyph's kind; every choice applies, then closes it. */
function AttributePopoverPanel({
    event,
    manipulator,
    className,
    onClose,
}: {
    event: AttributeClickEvent
    manipulator: ScoreManipulator
    className: string
    onClose: () => void
}) {
    switch (event.kind) {
        case 'tempo':
            return (
                <TempoPopover
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
                    active={event.clef}
                    className={className}
                    onSelect={(type) => {
                        manipulator.setClefAt(event.measureIndex, type)
                        onClose()
                    }}
                    onDismiss={onClose}
                />
            )
        case 'key':
            return (
                <KeySignaturePopover
                    active={event.fifths}
                    className={className}
                    onSelect={(fifths) => {
                        manipulator.setKeyAt(event.measureIndex, fifths)
                        onClose()
                    }}
                    onDismiss={onClose}
                />
            )
        case 'time':
            return (
                <TimeSignaturePopover
                    active={{ beatAmount: event.beatAmount, beatType: event.beatType }}
                    className={className}
                    onSelect={(beatAmount, beatType) => {
                        manipulator.setTimeSignatureAt(event.measureIndex, beatAmount, beatType)
                        onClose()
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
