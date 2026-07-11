'use client'

import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'

import type { RecordingWaveformStore } from '@/lib/RecordingWaveformStore'
import { Note, Pitch, Score as ScoreModel } from '@/model'
import { MeasureLayout as MeasureLayoutModel } from '@/model/layout/MeasureLayout'

import { Barline } from './Barline'
import { INTERACTION_BLUE, MEASURE_BUTTON_GAP, MEASURE_BUTTON_SIZE, NUM_STAFF_LINES, SCORE_WIDTH, SPACE_ABOVE_STAFF, STAVE_LINE_DISTANCE } from './constants'
import { CursorIndicator } from './CursorIndicator'
import { Measure } from './Measure'
import { MeasureButton } from './MeasureButton'
import { NoteGroup } from './NoteGroup'
import { getLineForY } from './noteUtils'
import { RecordingWaveform } from './RecordingWaveform'
import { StaffLines } from './StaffLines'
import { TempoMarking } from './TempoMarking'
import { TempoPopover } from './TempoPopover'
import { Tie } from './Tie'

/** Vertical offset from the reference Y to the teardrop tip */
const CURSOR_Y_OFFSET = 15

/**
 * Below this container width the layout reflows to the container instead of
 * scaling down: rows are packed against the viewport so notation keeps its
 * full glyph size on phones and narrow windows (see Score.setLayoutWidth).
 */
const REFLOW_BREAKPOINT = 768
/** Floor for the reflowed layout width — keeps a crowded measure legible on the narrowest phones. */
const MIN_LAYOUT_WIDTH = 340
/** Breathing room kept between the followed row and the scroll viewport's edges. */
const FOLLOW_SCROLL_MARGIN = 16

/** The nearest ancestor that scrolls vertically — where selection/cursor following happens. */
function findScrollParent(el: HTMLElement | null): HTMLElement | null {
    for (let node = el?.parentElement ?? null; node; node = node.parentElement) {
        const overflowY = getComputedStyle(node).overflowY
        if (overflowY === 'auto' || overflowY === 'scroll') return node
    }
    return null
}

interface ScoreProps {
    score: ScoreModel
    layoutId: string
    height?: number
    selectedNote?: Note | null
    /** Every selected note (a run when the user drags/shift-selects); drives the highlight. */
    selectedNotes?: Note[]
    playbackCursorRef?: React.RefObject<SVGRectElement | null>
    /** Live recording waveform bars; the layer subscribes to it directly. */
    waveformStore?: RecordingWaveformStore
    /** Begin a selection on `note` (plain click / drag start). */
    onSelectionStart?: (note: Note) => void
    /** Extend the selection to `note` (drag move / shift-click). */
    onSelectionExtend?: (note: Note) => void
    onNoteChange?: (note: Note, newPitch: Pitch) => void
    onAddMeasure?: () => void
    onRemoveMeasure?: () => void
    canRemoveMeasure?: boolean
    onTempoChange?: (measureIndex: number, beatPosition: number, bpm: number) => void
}

export const Score = memo(function Score({
    score,
    selectedNote,
    selectedNotes,
    playbackCursorRef,
    waveformStore,
    onSelectionStart,
    onSelectionExtend,
    onNoteChange,
    onAddMeasure,
    onRemoveMeasure,
    canRemoveMeasure = true,
    onTempoChange,
}: ScoreProps) {
    const containerRef = useRef<HTMLDivElement>(null)
    const svgRef = useRef<SVGSVGElement>(null)
    // Pointer-drag state for range selection: whether the button is down, and whether the pointer
    // has moved onto a different note since mousedown (a drag, which suppresses the click action).
    const pointerDownRef = useRef(false)
    const dragMovedRef = useRef(false)
    const [containerWidth, setContainerWidth] = useState(0)
    const [hoveredNote, setHoveredNote] = useState<Note | null>(null)
    const [ghostNote, setGhostNote] = useState<Note | null>(null)
    const selectedIds = useMemo(() => new Set((selectedNotes ?? []).map((n) => n.id)), [selectedNotes])
    const [openPopover, setOpenPopover] = useState<{
        measureIndex: number
        beatPosition: number
        bpm: number
        x: number
        y: number
    } | null>(null)

    useEffect(() => {
        const el = containerRef.current
        if (!el) return
        const observer = new ResizeObserver((entries) => {
            const entry = entries[0]
            if (!entry) return
            const width = entry.contentRect.width
            // Reflow instead of shrink: on narrow containers the layout packs rows
            // against the available width, so glyphs render at full size on phones.
            score.setLayoutWidth(width > 0 && width < REFLOW_BREAKPOINT ? Math.max(MIN_LAYOUT_WIDTH, Math.floor(width)) : SCORE_WIDTH)
            setContainerWidth(width)
        })
        observer.observe(el)
        return () => observer.disconnect()
    }, [score])

    // The current layout snapshot (rebuilt lazily by the model when the score changed)
    const layout = score.layout
    const showMeasureButtons = !!(onAddMeasure || onRemoveMeasure)
    const rows = layout.rows
    const totalHeight = layout.totalHeight
    const scaledHeight = containerWidth > 0 ? totalHeight * (containerWidth / layout.scoreWidth) : 0

    // Cursor indicator position (row-local coordinates)
    const cursorPos = useMemo(() => {
        if (!selectedNote) return null
        const x = selectedNote.layout.noteX + selectedNote.layout.width.noteHeadWidth / 2
        let lowestY = selectedNote.layout.noteY
        const stem = selectedNote.layout.stem
        if (stem) lowestY = Math.max(lowestY, stem.y1, stem.y2)
        const bottomStaffY = SPACE_ABOVE_STAFF * STAVE_LINE_DISTANCE + (NUM_STAFF_LINES - 1) * STAVE_LINE_DISTANCE
        const y = Math.max(bottomStaffY, lowestY) + CURSOR_Y_OFFSET
        return { x, y }
    }, [selectedNote, selectedNote?.layout.id])

    // Client to SVG coordinate conversion
    const clientToSvg = useCallback(
        (clientX: number, clientY: number): { x: number; y: number } | null => {
            const svg = svgRef.current
            if (!svg) return null
            const rect = svg.getBoundingClientRect()
            return {
                x: ((clientX - rect.left) / rect.width) * score.layout.scoreWidth,
                y: ((clientY - rect.top) / rect.height) * totalHeight,
            }
        },
        [totalHeight, score],
    )

    // SVG coordinate to container-relative pixel position (inverse of clientToSvg)
    const svgToContainer = useCallback(
        (svgX: number, svgY: number): { x: number; y: number } | null => {
            const svg = svgRef.current
            const container = containerRef.current
            if (!svg || !container) return null
            const svgRect = svg.getBoundingClientRect()
            const containerRect = container.getBoundingClientRect()
            const scaleX = svgRect.width / score.layout.scoreWidth
            const scaleY = svgRect.height / totalHeight
            return {
                x: svgRect.left + svgX * scaleX - containerRect.left,
                y: svgRect.top + svgY * scaleY - containerRect.top,
            }
        },
        [totalHeight, score],
    )

    // Scroll the nearest scrollable ancestor so the row at `layoutY` sits inside the
    // viewport (no-op when it already does) — how the selection and the playback
    // cursor stay in view on small screens.
    const scrollRowIntoView = useCallback(
        (layoutY: number) => {
            const svg = svgRef.current
            const scroller = findScrollParent(containerRef.current)
            if (!svg || !scroller) return
            const scale = svg.getBoundingClientRect().width / score.layout.scoreWidth
            const svgTop = svg.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop
            const rowTop = svgTop + layoutY * scale
            const rowBottom = rowTop + score.layout.rowHeight * scale
            if (rowTop < scroller.scrollTop + FOLLOW_SCROLL_MARGIN) {
                scroller.scrollTo({ top: Math.max(0, rowTop - FOLLOW_SCROLL_MARGIN), behavior: 'smooth' })
            } else if (rowBottom > scroller.scrollTop + scroller.clientHeight - FOLLOW_SCROLL_MARGIN) {
                scroller.scrollTo({ top: rowBottom - scroller.clientHeight + FOLLOW_SCROLL_MARGIN, behavior: 'smooth' })
            }
        },
        [score],
    )

    // Keep the selected note's row visible whenever the selection moves (taps,
    // arrow keys, the mobile note navigator).
    useEffect(() => {
        if (!selectedNote) return
        try {
            const row = score.layout.rowFor(selectedNote.measure)
            scrollRowIntoView(score.layout.getYForRow(row))
        } catch {
            // A selection can briefly reference a measure detached by an in-flight edit.
        }
    }, [selectedNote, score, scrollRowIntoView])

    // Follow playback/recording: the engines drive the cursor rect's transform
    // directly, so a row change surfaces here as an attribute mutation.
    useEffect(() => {
        const cursor = playbackCursorRef?.current
        if (!cursor || containerWidth === 0) return
        const observer = new MutationObserver(() => {
            if (cursor.getAttribute('display') === 'none') return
            const match = /translate\(\s*0\s*[,\s]\s*([\d.]+)\s*\)/.exec(cursor.getAttribute('transform') ?? '')
            if (match) scrollRowIntoView(Number(match[1]))
        })
        observer.observe(cursor, { attributes: true, attributeFilter: ['transform', 'display'] })
        return () => observer.disconnect()
    }, [playbackCursorRef, containerWidth, scrollRowIntoView])

    const handleTempoClick = useCallback(
        (measureIndex: number, beatPosition: number, bpm: number, svgX: number, svgY: number) => {
            const pos = svgToContainer(svgX, svgY)
            if (!pos) return
            setOpenPopover({ measureIndex, beatPosition, bpm, x: pos.x, y: pos.y })
        },
        [svgToContainer],
    )

    // Resolve the note under a client point (row → measure → note), with the row-local Y.
    const resolveHit = useCallback(
        (clientX: number, clientY: number): { note: Note; localY: number } | null => {
            const pt = clientToSvg(clientX, clientY)
            if (!pt) return null
            const row = score.layout.getRowForY(pt.y)
            if (!row) return null
            const measure = row.getMeasureForX(pt.x)
            if (!measure) return null
            const note = measure.layout.getNoteForX(pt.x - row.getMeasureX(measure))
            if (!note) return null
            return { note, localY: pt.y - score.layout.getYForRow(row) }
        },
        [clientToSvg, score],
    )

    const handlePointerMove = useCallback(
        (e: React.PointerEvent<SVGSVGElement>) => {
            const hit = resolveHit(e.clientX, e.clientY)
            if (!hit) {
                if (hoveredNote) setHoveredNote(null)
                if (ghostNote) setGhostNote(null)
                return
            }
            const { note, localY } = hit
            if (note.id !== hoveredNote?.id) setHoveredNote(note)

            // Button down: only once the pointer reaches a *different* note is it a drag — extend
            // the selection then. Staying on the press note leaves the ghost intact so a press +
            // release in place still commits a pitch change (below).
            if (pointerDownRef.current) {
                if (note.id !== selectedNote?.id) {
                    if (ghostNote) setGhostNote(null)
                    dragMovedRef.current = true
                    onSelectionExtend?.(note)
                }
                return
            }

            // Hover-to-pitch preview is a mouse affordance; a finger can't hover, and on
            // touch the ghost would flash under every tap.
            if (e.pointerType !== 'mouse') return
            const hoverLine = getLineForY(localY)
            // hoverLine is a rendered staff line; convert to a pitch under the note's active clef, then spell
            // it under the active key (an F on the F line in G major becomes F♯, with no accidental drawn).
            if ((hoverLine === note.line && ghostNote) || note !== selectedNote) setGhostNote(null)
            else setGhostNote(note.clone({ pitch: note.keySignature.spell(note.clef.pitchForLine(hoverLine)) }).previewUnder(note.clef))
        },
        [resolveHit, hoveredNote, ghostNote, selectedNote, onSelectionExtend],
    )

    const handlePointerDown = useCallback(
        (e: React.PointerEvent<SVGSVGElement>) => {
            if (openPopover) return
            const hit = resolveHit(e.clientX, e.clientY)
            if (!hit) return
            pointerDownRef.current = true
            dragMovedRef.current = false
            // Shift extends the existing selection to the pressed note; a plain press starts a new one.
            if (e.shiftKey) onSelectionExtend?.(hit.note)
            else onSelectionStart?.(hit.note)
        },
        [openPopover, resolveHit, onSelectionStart, onSelectionExtend],
    )

    // A drag can end with the pointer outside the score (or be taken over by a
    // scroll gesture on touch), so listen on the window.
    useEffect(() => {
        const endDrag = () => {
            pointerDownRef.current = false
        }
        window.addEventListener('pointerup', endDrag)
        window.addEventListener('pointercancel', endDrag)
        return () => {
            window.removeEventListener('pointerup', endDrag)
            window.removeEventListener('pointercancel', endDrag)
        }
    }, [])

    const handlePointerLeave = useCallback(() => {
        setHoveredNote(null)
        setGhostNote(null)
    }, [])

    const handleClick = useCallback(() => {
        if (openPopover) {
            setOpenPopover(null)
            return
        }
        // A drag selected a range — that's not a click, so don't also commit a pitch change.
        if (dragMovedRef.current) return
        // Clicking the active note at a different staff line commits the previewed (ghost) pitch.
        if (ghostNote?.pitch && selectedNote && onNoteChange) {
            setGhostNote(null)
            onNoteChange(selectedNote, ghostNote.pitch)
        }
    }, [openPopover, ghostNote, selectedNote, onNoteChange])

    // Measure button positions (last row only)
    const measureButtonPos = useMemo(() => {
        const lastRow = rows[rows.length - 1]
        if (!lastRow || !showMeasureButtons) return null
        const lastMeasure = lastRow.measures[lastRow.measures.length - 1]
        const barline = lastMeasure?.layout.barline
        if (!barline) return null
        const measureX = lastRow.getMeasureX(lastMeasure)
        const staffCenterY = barline.y + barline.height / 2
        const x = measureX + barline.x + MeasureLayoutModel.barlineWidth(lastMeasure.endBarline) + 10
        const btnTotalHeight = MEASURE_BUTTON_SIZE * 2 + MEASURE_BUTTON_GAP
        const topY = staffCenterY - btnTotalHeight / 2
        return { x, topY }
    }, [rows, showMeasureButtons])

    const lastRowIndex = rows.length - 1

    return (
        <div ref={containerRef} className="relative select-none">
            {containerWidth > 0 && totalHeight > 0 && score.layout && (
                <svg
                    ref={svgRef}
                    width={containerWidth}
                    height={scaledHeight}
                    viewBox={`0 0 ${layout.scoreWidth} ${totalHeight}`}
                    xmlns="http://www.w3.org/2000/svg"
                    // pan-y: vertical touch gestures keep scrolling the page, while taps and
                    // horizontal drags reach the pointer handlers (select / drag-extend).
                    className="touch-pan-y"
                    onPointerDown={handlePointerDown}
                    onPointerMove={handlePointerMove}
                    onPointerLeave={handlePointerLeave}
                    onClick={handleClick}>
                    {/* Live recording waveform — its own store-subscribed layer, so
                        sample-rate updates never re-render the score itself */}
                    {waveformStore && <RecordingWaveform store={waveformStore} score={score} />}

                    {/* Playback cursor — positioned directly by PlaybackEngine via ref */}
                    <rect
                        ref={playbackCursorRef}
                        data-export-exclude
                        display="none"
                        y={SPACE_ABOVE_STAFF * STAVE_LINE_DISTANCE - 5}
                        width={3}
                        height={(NUM_STAFF_LINES - 1) * STAVE_LINE_DISTANCE + 10}
                        fill={INTERACTION_BLUE}
                        rx={1.5}
                    />

                    {rows.map((row) =>
                        row.measures.map((measure) => (
                            <g key={measure.id} transform={`translate(${row.getMeasureX(measure)}, ${layout.getYForRow(row)})`}>
                                <Measure
                                    measure={measure}
                                    selectedNoteIds={selectedIds}
                                    hoveredNote={hoveredNote}
                                    layoutId={measure.layout.id}
                                />

                                {selectedNote && selectedNote.measure === measure && cursorPos && (
                                    <g
                                        key={`cursor-${selectedNote.id}`}
                                        data-export-exclude
                                        transform={`translate(${measure.layout.getXForElement(selectedNote)}, 0)`}>
                                        {ghostNote && (
                                            <g key={ghostNote.id} opacity={0.35}>
                                                <NoteGroup note={ghostNote} layoutId={ghostNote.layout.id} />
                                            </g>
                                        )}
                                        <CursorIndicator x={cursorPos.x} y={cursorPos.y} />
                                    </g>
                                )}

                                {measure.tempos.map((tempo, ti) => (
                                    <g
                                        key={`cursor-${tempo.id}`}
                                        transform={`translate(${measure.layout.getXForBeat(tempo.beatPosition)}, 0)`}>
                                        <TempoMarking
                                            key={`tempo-${ti}`}
                                            tempo={tempo}
                                            layoutId={tempo.layout.id}
                                            onClick={() =>
                                                handleTempoClick(
                                                    score.getIndexForMeasure(tempo.measure),
                                                    tempo.beatPosition,
                                                    tempo.bpm,
                                                    row.getMeasureX(tempo.measure) + tempo.measure.layout.getXForBeat(tempo.beatPosition),
                                                    layout.getYForRow(row) + tempo.layout.y,
                                                )
                                            }
                                        />
                                    </g>
                                ))}
                            </g>
                        )),
                    )}

                    {rows.map((row, ri) => (
                        <g key={row.id} transform={`translate(0, ${layout.getYForRow(row)})`}>
                            <StaffLines lines={row.staffLines} />

                            <Barline layout={row.openingBarline} />

                            {/* Ties are laid out in row-local coordinates; each renders only the segments on this row */}
                            {layout.ties.map((tie) => (
                                <Tie key={`${tie.note.id}-${row.id}`} layout={tie} layoutId={tie.id} rowIndex={row.index} />
                            ))}

                            {ri === lastRowIndex && measureButtonPos && onAddMeasure && (
                                <MeasureButton
                                    x={measureButtonPos.x}
                                    y={measureButtonPos.topY}
                                    size={MEASURE_BUTTON_SIZE}
                                    label="+"
                                    onClick={onAddMeasure}
                                />
                            )}
                            {ri === lastRowIndex && measureButtonPos && onRemoveMeasure && (
                                <MeasureButton
                                    x={measureButtonPos.x}
                                    y={measureButtonPos.topY + MEASURE_BUTTON_SIZE + MEASURE_BUTTON_GAP}
                                    size={MEASURE_BUTTON_SIZE}
                                    label="-"
                                    onClick={onRemoveMeasure}
                                    disabled={!canRemoveMeasure}
                                />
                            )}
                        </g>
                    ))}
                </svg>
            )}
            {openPopover && (
                <TempoPopover
                    x={openPopover.x}
                    y={openPopover.y - 30}
                    initialBpm={openPopover.bpm}
                    onSubmit={(bpm) => {
                        onTempoChange?.(openPopover.measureIndex, openPopover.beatPosition, bpm)
                        setOpenPopover(null)
                    }}
                    onDismiss={() => setOpenPopover(null)}
                />
            )}
        </div>
    )
})
