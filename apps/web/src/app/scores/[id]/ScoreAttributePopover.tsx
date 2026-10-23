'use client'

import type { AttributeClickEvent } from '@mushee/notation/components'
import { NUM_STAFF_LINES, SPACE_ABOVE_STAFF, STAVE_LINE_DISTANCE, TEMPO_MARKING_Y } from '@mushee/notation/engraving/constants'
import { TimeSignature } from '@mushee/notation/model'
import { type ReactNode, useEffect, useLayoutEffect, useRef, useState } from 'react'

import { ClefPopover } from '@/components/editor/ClefPopover'
import { KeySignaturePopover } from '@/components/editor/KeySignaturePopover'
import { TempoPopover } from '@/components/editor/TempoPopover'
import { TimeSignaturePopover } from '@/components/editor/TimeSignaturePopover'
import { usePickConfirmation } from '@/components/ui'
import { TOOLTIP_HOVER_DELAY_MS, TooltipCard } from '@/components/ui/Tooltip'

import type { ScoreManipulator } from './ScoreManipulator'

/** Meter assumed for the in-score tempo popover when its measure is gone (the score reloaded underneath it). */
const DEFAULT_TIME_SIGNATURE = new TimeSignature(4, 4)

/** Space kept between an anchored attribute popover and the score wrapper's side edges. */
const POPOVER_EDGE_MARGIN = 8
/**
 * How far below the clicked row's bottom staff line every in-score popover opens — clear of a
 * ledger-line note under the staff, so the bar being changed stays in view.
 */
const ATTRIBUTE_POPOVER_GAP = 24
/** A popover flipped above the row (no room below it) keeps this gap over the row's top. */
const ATTRIBUTE_POPOVER_FLIP_GAP = 8
/** The hover label's gap above the glyph it names. */
const HOVER_TIP_GAP = 8

/** The staff's top line and height in a row's layout units (the row's top is 0). */
const STAFF_TOP = SPACE_ABOVE_STAFF * STAVE_LINE_DISTANCE
const STAFF_HEIGHT = (NUM_STAFF_LINES - 1) * STAVE_LINE_DISTANCE

/**
 * The top of the clicked row, in the same container pixels as the event: a glyph's click
 * anchors at the staff top, a tempo mark's at the marking, and the staff bottom gives the scale.
 */
function rowTopOf(event: AttributeClickEvent): number {
    const anchorY = event.kind === 'tempo' ? TEMPO_MARKING_Y : STAFF_TOP
    const pxPerUnit = (event.staffBottom - event.y) / (STAFF_TOP + STAFF_HEIGHT - anchorY)
    return event.y - anchorY * pxPerUnit
}

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
    return (
        <AttributePopoverAnchor x={event.x} below={event.staffBottom + ATTRIBUTE_POPOVER_GAP} rowTop={rowTopOf(event)}>
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
                    instrument={manipulator.score?.instrument}
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

/** The nearest ancestor that scrolls vertically — the editor's score area, whose visible box the popover must stay in. */
function scrollerOf(el: HTMLElement): HTMLElement | null {
    for (let node = el.parentElement; node; node = node.parentElement) {
        const { overflowY } = getComputedStyle(node)
        if (overflowY === 'auto' || overflowY === 'scroll') return node
    }
    return null
}

/**
 * Positions an in-score attribute popover at the clicked glyph: `below` the row, or — when the
 * panel would run past the bottom of the visible score area and there is room above — flipped
 * over the row's top, so it never covers the bar it changes. Pulled left just enough to stay
 * inside the score wrapper (its offsetParent), the same measure-and-clamp approach as
 * SelectionPopover, and travelling in from its side. Re-measured every render: the panel's size
 * depends on which popover is inside, and there is no ResizeObserver.
 */
function AttributePopoverAnchor({ x, below, rowTop, children }: { x: number; below: number; rowTop: number; children: ReactNode }) {
    const ref = useRef<HTMLDivElement>(null)
    const [position, setPosition] = useState<{ left: number; top: number } | null>(null)
    useLayoutEffect(() => {
        const el = ref.current
        const parent = el?.offsetParent as HTMLElement | null
        // Measure the popover panel, not the anchor: the panel is absolutely positioned
        // inside it, so the anchor itself has no size.
        const panel = el?.firstElementChild as HTMLElement | null
        if (!el || !parent || !panel) return
        const left = Math.min(x, Math.max(POPOVER_EDGE_MARGIN, parent.clientWidth - panel.offsetWidth - POPOVER_EDGE_MARGIN))
        const above = rowTop - ATTRIBUTE_POPOVER_FLIP_GAP - panel.offsetHeight
        const view = scrollerOf(parent)?.getBoundingClientRect()
        const parentTop = parent.getBoundingClientRect().top
        const flip = !!view && parentTop + below + panel.offsetHeight > view.bottom && parentTop + above >= view.top
        const top = flip ? above : below
        // Away from the row it opened from: up when it sits above, down when below (the Popover
        // set its own travel before this anchor moved it, so the side is decided here).
        panel.style.setProperty('--pop-from', flip ? '4px' : '-4px')
        setPosition((current) => (current?.left === left && current.top === top ? current : { left, top }))
    })
    return (
        <div
            ref={ref}
            className="absolute z-(--z-popover)"
            style={{ left: position?.left ?? x, top: position?.top ?? below, visibility: position === null ? 'hidden' : undefined }}>
            {children}
        </div>
    )
}

/**
 * The hover label over an in-score clef, key, time signature or tempo mark — "Change key" —
 * so the printed-looking glyphs say they can be clicked. Mouse hover only (the ScoreView
 * reports pen and mouse), after the shared tooltip delay; drawn in the shared TooltipCard.
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
        <TooltipCard
            label={CHANGE_LABEL[shown.kind]}
            className="absolute z-(--z-popover) -translate-x-1/2 -translate-y-full"
            style={{ left: shown.x, top: shown.y - HOVER_TIP_GAP }}
        />
    )
}
