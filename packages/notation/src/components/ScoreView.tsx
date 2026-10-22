'use client'

import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { MEASURE_BUTTON_OFFSET, SCORE_WIDTH } from '../engraving/constants'
import type { RecordingWaveformStore } from '../lib/RecordingWaveformStore'
import { useObservedWidth } from '../lib/useObservedWidth'
import { useScrollFollow } from '../lib/useScrollFollow'
import { useSelectionGestures } from '../lib/useSelectionGestures'
import type { Clef, Measure as MeasureModel, Note, Pitch, Score as ScoreModel } from '../model'
import { NoteLayout } from '../model/layout/NoteLayout'
import { Staff } from '../model/layout/Staff'
import { Barline } from './Barline'
import { INTERACTION_BLUE } from './constants'
import { HighlightLayer, type ScoreHighlight } from './HighlightLayer'
import { InputCursor } from './InputCursor'
import { type AttributeClick, Measure } from './Measure'
import { MeasureButton } from './MeasureButton'
import { NoteGroup } from './NoteGroup'
import { RecordingWaveform } from './RecordingWaveform'
import { StaffLines } from './StaffLines'
import { Tie } from './Tie'

/** Vertical offset from the staff bottom (or the selected note's lowest ink, when lower) to the input cursor's teardrop. */
const INPUT_CURSOR_GAP = 15
/** The hover-to-pitch ghost: its notehead's opacity, and its letter label's on-screen size and gap (CSS px). */
const GHOST_OPACITY = 0.5
const GHOST_LABEL_PX = 11
const GHOST_LABEL_GAP_PX = 6

/**
 * Below this container width the layout reflows to the container instead of
 * scaling down: rows are packed against the viewport so notation keeps its
 * full glyph size on phones and narrow windows (see Score.setLayoutWidth).
 * A measure too dense for that budget widens layout.scoreWidth instead of
 * failing, and the viewBox scale-to-fit shrinks it on screen.
 */
const REFLOW_BREAKPOINT = 768
/** Floor for the reflowed layout width — keeps a crowded measure legible on the narrowest phones. */
const MIN_LAYOUT_WIDTH = 340

interface ScoreViewProps {
    score: ScoreModel
    /**
     * Pass `score.layout.id`. The score mutates in place, so its identity never changes;
     * this prop is what makes the memo re-render when the score's layout snapshot moves.
     */
    layoutId: string
    /** The active note: the moving end of the selection, see ScoreManipulator._selectedNote. */
    selectedNote?: Note | null
    /** Every selected note (a run when the user drags/shift-selects); drives the highlight. */
    selectedNotes?: Note[]
    /** Transient magenta emphasis over part of the score (see {@link ScoreHighlight}); null/omitted renders nothing. */
    highlight?: ScoreHighlight | null
    playbackCursorRef?: React.RefObject<SVGRectElement | null>
    /** Live recording waveform bars; the layer subscribes to it directly. */
    waveformStore?: RecordingWaveformStore
    /** Begin a selection on `note` (plain click / drag start). */
    onSelectionStart?: (note: Note) => void
    /** Extend the selection to `note` (drag move / shift-click). */
    onSelectionExtend?: (note: Note) => void
    /**
     * A selection-menu gesture completed on `note`: long-press, double-tap, or lifting a
     * drag that extended the selection (the grammar of Android's text selection). Passing
     * this enables those gestures — the editor passes it on touch layouts to open its
     * selection popover; omit it and plain tap/drag selection is all there is. The menu's
     * position is the parent's business: derive it from the selection via
     * `ScoreLayout.selectionMenuAnchor`, so it can track selection changes while open.
     */
    onSelectionMenu?: (event: SelectionMenuEvent) => void
    onNoteChange?: (note: Note, newPitch: Pitch) => void
    onAddMeasure?: () => void
    onRemoveMeasure?: () => void
    canRemoveMeasure?: boolean
    /**
     * Draw the in-score + / − bar buttons (given their callbacks). Default true; a host that
     * renders its own HTML buttons from {@link onMeasureButtonsLayout} turns them off.
     */
    showMeasureButtons?: boolean
    /**
     * Where the bar buttons go, in container pixels — reported whenever the layout or the
     * container width moves (null while there is nowhere to put them), whether or not the
     * in-score buttons are drawn, so a host can place its own controls there.
     */
    onMeasureButtonsLayout?: (rect: MeasureButtonsRect | null) => void
    /**
     * Whether the score takes pointer input. False (during a take): taps and clicks on notes,
     * glyphs and the bar buttons do nothing, nothing hovers, the bar buttons are hidden, and
     * native scrolling still works. Default true.
     */
    interactive?: boolean
    /**
     * A tempo marking, clef, key or time signature was clicked. The score only reports the
     * event — what happens next (the editor opens its popover) is the parent's call; omit the
     * callback and the glyphs render inert (the read-only consumers pass nothing).
     */
    onAttributeClick?: (event: AttributeClickEvent) => void
    /**
     * A mouse or pen entered one of those glyphs (the event says which) or left it (null) — so
     * the host can say what a click would change ('Change key'). Needs `onAttributeClick`.
     */
    onAttributeHover?: (event: AttributeClickEvent | null) => void
    /** Passed through to the score's container, for hosts that make it an accessible widget. */
    role?: string
    'aria-roledescription'?: string
    'aria-label'?: string
    'aria-describedby'?: string
}

/** A square in container pixels: its top-left corner and side. */
export interface PixelSquare {
    x: number
    y: number
    size: number
}

/** The bar-button area after the final barline, in pixels relative to the score's container. */
export interface MeasureButtonsRect {
    /** The final barline's x. */
    barlineX: number
    /** The last row's top and bottom staff lines. */
    staffTop: number
    staffBottom: number
    /** The in-score + (add a bar) and − (remove the last bar) buttons. */
    add: PixelSquare
    remove: PixelSquare
}

export interface SelectionMenuEvent {
    note: Note
}

/**
 * A clicked attribute glyph, discriminated by `kind`, in the measure at `measureIndex`.
 * `x`/`y` are pixel coordinates relative to the score's container, ready to anchor a popover:
 * the marking itself for a tempo, the staff top for a clef, key or time signature.
 * `staffBottom` is the y of that row's bottom staff line, for a popover that must open below
 * the row instead of covering the bar being edited.
 */
export type AttributeClickEvent = AttributeClick & { measureIndex: number; x: number; y: number; staffBottom: number }

export const ScoreView = memo(function ScoreView({
    score,
    selectedNote,
    selectedNotes,
    highlight,
    playbackCursorRef,
    waveformStore,
    onSelectionStart,
    onSelectionExtend,
    onSelectionMenu,
    onNoteChange,
    onAddMeasure,
    onRemoveMeasure,
    canRemoveMeasure = true,
    showMeasureButtons: drawMeasureButtons = true,
    onMeasureButtonsLayout,
    interactive = true,
    onAttributeClick,
    onAttributeHover,
    role,
    'aria-roledescription': ariaRoleDescription,
    'aria-label': ariaLabel,
    'aria-describedby': ariaDescribedBy,
}: ScoreViewProps) {
    const containerRef = useRef<HTMLDivElement>(null)
    const svgRef = useRef<SVGSVGElement>(null)
    const [containerWidth, setContainerWidth] = useState(0)
    const [hoveredNote, setHoveredNote] = useState<Note | null>(null)
    // The hover-to-pitch preview: a detached clone of the selected note (`source`) at the hovered
    // staff line, under its clef. `line` is that rendered line — the detached clone's own `line`
    // ignores the clef — so a move along the same line can keep the ghost as it is.
    const [ghost, setGhost] = useState<{ source: Note; line: number; note: Note; clef: Clef } | null>(null)
    // A view-only score shows no preview, even one left over from before it went view-only.
    const activeGhost = interactive ? ghost : null
    const ghostNote = activeGhost?.note ?? null
    const ghostLayout = useMemo(() => activeGhost && NoteLayout.preview(activeGhost.note, activeGhost.clef), [activeGhost])
    const selectedIds = useMemo(() => new Set((selectedNotes ?? []).map((n) => n.id)), [selectedNotes])

    useObservedWidth(
        containerRef,
        useCallback(
            (width: number) => {
                // Reflow instead of shrink: on narrow containers the layout packs rows
                // against the available width, so glyphs render at full size on phones.
                score.setLayoutWidth(width > 0 && width < REFLOW_BREAKPOINT ? Math.max(MIN_LAYOUT_WIDTH, Math.floor(width)) : SCORE_WIDTH)
                setContainerWidth(width)
            },
            [score],
        ),
    )

    // The current layout snapshot (rebuilt lazily by the model when the score changed)
    const layout = score.layout
    const showMeasureButtons = drawMeasureButtons && interactive && !!(onAddMeasure || onRemoveMeasure)
    const rows = layout.rows
    const totalHeight = layout.totalHeight
    const scaledHeight = containerWidth > 0 ? totalHeight * (containerWidth / layout.scoreWidth) : 0
    // The svg renders once the container has been measured (and there is a row to draw).
    const svgMounted = containerWidth > 0 && totalHeight > 0

    // Input-cursor position: note-local x, row-local y
    const inputCursorPos = useMemo(() => {
        if (!selectedNote) return null
        const x = selectedNote.layout.noteX + selectedNote.layout.width.noteHeadWidth / 2
        let lowestY = selectedNote.layout.noteY
        const stem = selectedNote.layout.stem
        if (stem) lowestY = Math.max(lowestY, stem.y1, stem.y2)
        const bottomStaffY = Staff.TOP_Y + Staff.HEIGHT
        const y = Math.max(bottomStaffY, lowestY) + INPUT_CURSOR_GAP
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

    useScrollFollow({ svgRef, containerRef, score, selectedNote, playbackCursorRef, mounted: svgMounted })

    // Attribute glyphs only *report* clicks and hovers, in container pixels — opening an
    // editing surface or a tooltip is the parent's business. One stable handler each for every
    // measure (a per-measure adapter would defeat memo(Measure)); they convert the measure-local
    // point to container pixels at event time, against the layout the event landed on.
    const attributeEvent = useCallback(
        (measure: MeasureModel, click: AttributeClick, localX: number, localY: number): AttributeClickEvent | null => {
            const svg = svgRef.current
            const container = containerRef.current
            if (!svg || !container) return null
            const current = score.layout
            const row = current.rowFor(measure)
            const svgRect = svg.getBoundingClientRect()
            const containerRect = container.getBoundingClientRect()
            const rowY = current.getYForRow(row)
            const toY = (svgY: number) => svgRect.top + svgY * (svgRect.height / current.totalHeight) - containerRect.top
            return {
                ...click,
                measureIndex: score.getIndexForMeasure(measure),
                x: svgRect.left + (row.getMeasureX(measure) + localX) * (svgRect.width / current.scoreWidth) - containerRect.left,
                y: toY(rowY + localY),
                staffBottom: toY(rowY + Staff.TOP_Y + Staff.HEIGHT),
            }
        },
        [score],
    )
    const handleAttributeClick = useCallback(
        (measure: MeasureModel, click: AttributeClick, localX: number, localY: number) => {
            const event = attributeEvent(measure, click, localX, localY)
            if (event) onAttributeClick?.(event)
        },
        [attributeEvent, onAttributeClick],
    )
    const handleAttributeHover = useCallback(
        (measure: MeasureModel, click: AttributeClick | null, localX: number, localY: number) => {
            onAttributeHover?.(click && attributeEvent(measure, click, localX, localY))
        },
        [attributeEvent, onAttributeHover],
    )
    // Going view-only under a hovering pointer leaves no pointerleave to report: clear it here.
    useEffect(() => {
        if (!interactive) onAttributeHover?.(null)
    }, [interactive, onAttributeHover])

    // Report where the bar buttons go, in container pixels (the svg sits at the container's
    // origin, scaled to its width), so a host can put its own controls there.
    const measureButtonsLayout = layout.measureButtons
    const lastRow = layout.rows[layout.rows.length - 1]
    useEffect(() => {
        if (!onMeasureButtonsLayout) return
        if (!svgMounted || !measureButtonsLayout || !lastRow) {
            onMeasureButtonsLayout(null)
            return
        }
        const scale = containerWidth / layout.scoreWidth
        const rowY = layout.getYForRow(lastRow)
        const square = (y: number): PixelSquare => ({
            x: measureButtonsLayout.x * scale,
            y: (rowY + y) * scale,
            size: measureButtonsLayout.size * scale,
        })
        onMeasureButtonsLayout({
            barlineX: (measureButtonsLayout.x - MEASURE_BUTTON_OFFSET) * scale,
            staffTop: (rowY + Staff.TOP_Y) * scale,
            staffBottom: (rowY + Staff.TOP_Y + Staff.HEIGHT) * scale,
            add: square(measureButtonsLayout.addY),
            remove: square(measureButtonsLayout.removeY),
        })
    }, [onMeasureButtonsLayout, svgMounted, measureButtonsLayout, lastRow, containerWidth, layout])

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

    // Gesture recognition (press/drag selection, and the long-press / double-tap /
    // drag-release menu gestures) lives in the reusable recognizer; this component only
    // resolves hits and renders. Menu gestures exist only when the parent passes
    // `onSelectionMenu` — the editor does so on touch layouts.
    const gestures = useSelectionGestures<Note>({
        targetId: (note) => note.id,
        isSelected: (note) => selectedIds.has(note.id),
        isOnlySelected: (note) => selectedIds.size === 1 && selectedIds.has(note.id),
        onSelectionStart: interactive ? onSelectionStart : undefined,
        onSelectionExtend: interactive ? onSelectionExtend : undefined,
        onSelectionMenu: interactive && onSelectionMenu ? (gesture) => onSelectionMenu({ note: gesture.target }) : undefined,
    })

    const handlePointerMove = useCallback(
        (e: React.PointerEvent<SVGSVGElement>) => {
            // View-only: nothing hovers or previews (scrolling is native and needs no handler).
            if (!interactive) {
                if (hoveredNote) setHoveredNote(null)
                if (ghost) setGhost(null)
                return
            }
            const hit = resolveHit(e.clientX, e.clientY)
            if (!hit) {
                gestures.pointerMove(e, null)
                if (hoveredNote) setHoveredNote(null)
                if (ghost) setGhost(null)
                return
            }
            const { note, localY } = hit
            if (note.id !== hoveredNote?.id) setHoveredNote(note)

            gestures.pointerMove(e, note)
            // Button down: a drag extends the selection (inside the recognizer). Staying on the
            // press note leaves the ghost intact so a press + release in place still commits a
            // pitch change (below).
            if (gestures.pressed()) {
                if (gestures.dragged() && ghost) setGhost(null)
                return
            }

            // Hover-to-pitch preview is a mouse affordance; a finger can't hover, and on
            // touch the ghost would flash under every tap.
            if (e.pointerType !== 'mouse') return
            const hoverLine = Staff.noteLineForY(localY)
            // Only the selected note previews, and never at its own pitch (nothing would change). A
            // rest has no pitch, so it still previews — and commits — a note at its rest line.
            const noOp = !!note.pitch && hoverLine === note.line
            if (note !== selectedNote || noOp) {
                if (ghost) setGhost(null)
                return
            }
            // Same note, same line: the ghost already shows it — no rebuild per pointer move.
            if (ghost && ghost.source === note && ghost.line === hoverLine) return
            // hoverLine is a rendered staff line; convert to a pitch under the note's active clef, then spell
            // it under the active key (an F on the F line in G major becomes F♯, with no accidental drawn).
            const pitch = note.keySignature.spell(note.clef.pitchForLine(hoverLine))
            setGhost({ source: note, line: hoverLine, note: note.clone({ pitch }), clef: note.clef })
        },
        [interactive, resolveHit, gestures, hoveredNote, ghost, selectedNote],
    )

    const handlePointerDown = useCallback(
        (e: React.PointerEvent<SVGSVGElement>) => {
            if (!interactive) return
            const hit = resolveHit(e.clientX, e.clientY)
            if (hit) gestures.pointerDown(e, hit.note)
        },
        [interactive, resolveHit, gestures],
    )

    // A right-click reports the note under it, so the menu opens over that note or its selection.
    const handleContextMenu = useCallback(
        (e: React.MouseEvent<SVGSVGElement>) => {
            const pointerType = 'pointerType' in e.nativeEvent ? (e.nativeEvent as PointerEvent).pointerType : undefined
            gestures.contextMenu({ preventDefault: () => e.preventDefault(), pointerType }, resolveHit(e.clientX, e.clientY)?.note ?? null)
        },
        [gestures, resolveHit],
    )

    const handlePointerLeave = useCallback(() => {
        setHoveredNote(null)
        setGhost(null)
    }, [])

    const handleClick = useCallback(() => {
        // A drag or menu gesture already consumed this press — its trailing click is exhaust.
        if (!interactive || gestures.clickSuppressed()) return
        // Clicking the active note at a different staff line commits the previewed (ghost) pitch.
        if (ghostNote?.pitch && selectedNote && onNoteChange) {
            setGhost(null)
            onNoteChange(selectedNote, ghostNote.pitch)
        }
    }, [interactive, gestures, ghostNote, selectedNote, onNoteChange])

    // Measure buttons (last row only), placed by the layout
    const measureButtons = showMeasureButtons ? layout.measureButtons : null

    const lastRowIndex = rows.length - 1
    // Hover reaches only the hovered note's own measure, so the other measures' memos hold. An
    // edit can detach the hovered note under a still pointer; then nothing is hovered.
    const hoveredMeasure = interactive && hoveredNote?.isAttached ? hoveredNote.measure : null
    const hoveringSelected = interactive && !!onNoteChange && !!selectedNote && hoveredNote === selectedNote
    // Layout units per CSS pixel: the svg renders the layout scaled to the container's width.
    const unitsPerPx = containerWidth > 0 ? layout.scoreWidth / containerWidth : 1

    return (
        <div
            ref={containerRef}
            className="relative select-none"
            role={role}
            aria-roledescription={ariaRoleDescription}
            aria-label={ariaLabel}
            aria-describedby={ariaDescribedBy}>
            {svgMounted && (
                <svg
                    ref={svgRef}
                    width={containerWidth}
                    height={scaledHeight}
                    viewBox={`0 0 ${layout.scoreWidth} ${totalHeight}`}
                    xmlns="http://www.w3.org/2000/svg"
                    // pan-y: vertical touch gestures keep scrolling the page, while taps and
                    // horizontal drags reach the pointer handlers (select / drag-extend).
                    // touch-callout off: an iOS long-press must open the selection menu, not the OS callout.
                    // The pointer cursor over the selected note's column says a click there changes it.
                    className={`touch-pan-y [-webkit-touch-callout:none] ${hoveringSelected ? 'cursor-pointer' : ''}`}
                    onPointerDown={handlePointerDown}
                    onPointerMove={handlePointerMove}
                    onPointerLeave={handlePointerLeave}
                    onContextMenu={interactive ? handleContextMenu : undefined}
                    onClick={handleClick}>
                    {/* Pitch-operation emphasis — the lowest layer, a wash behind all ink */}
                    {highlight && <HighlightLayer key={highlight.id} score={score} highlight={highlight} />}

                    {/* Live recording waveform — its own store-subscribed layer, so
                        sample-rate updates never re-render the score itself */}
                    {waveformStore && <RecordingWaveform store={waveformStore} score={score} />}

                    {/* Playback cursor — the host's transport writes its x, transform and display
                        straight through the ref, outside React (the scroll-follow observes those writes) */}
                    <rect
                        ref={playbackCursorRef}
                        data-export-exclude
                        display="none"
                        y={Staff.TOP_Y - 5}
                        width={3}
                        height={Staff.HEIGHT + 10}
                        fill={INTERACTION_BLUE}
                        rx={1.5}
                    />

                    {rows.map((row) =>
                        row.measures.map((measure) => (
                            <g key={measure.id} transform={`translate(${row.getMeasureX(measure)}, ${layout.getYForRow(row)})`}>
                                <Measure
                                    measure={measure}
                                    layout={layout.measureLayoutFor(measure)}
                                    selectedNoteIds={selectedIds}
                                    hoveredNoteId={hoveredNote && hoveredMeasure === measure ? hoveredNote.id : undefined}
                                    onAttributeClick={interactive && onAttributeClick ? handleAttributeClick : undefined}
                                    onAttributeHover={onAttributeHover && handleAttributeHover}
                                />

                                {/* Pointer-transparent: the overlay paints above the measure's tempo
                                    markings, whose clicks must still reach them through a ghost. */}
                                {selectedNote && selectedNote.measure === measure && inputCursorPos && (
                                    <g
                                        key={`cursor-${selectedNote.id}`}
                                        data-export-exclude
                                        className="pointer-events-none"
                                        transform={`translate(${measure.layout.getXForElement(selectedNote)}, 0)`}>
                                        {ghostNote && ghostLayout && (
                                            <g key={ghostNote.id}>
                                                <g opacity={GHOST_OPACITY}>
                                                    <NoteGroup layout={ghostLayout} stem={ghostLayout.stem} beamed={false} />
                                                </g>
                                                {/* The note's name, for anyone who knows letters better than lines. */}
                                                <text
                                                    x={ghostLayout.noteRightX + GHOST_LABEL_GAP_PX * unitsPerPx}
                                                    y={ghostLayout.noteY}
                                                    fontSize={GHOST_LABEL_PX * unitsPerPx}
                                                    dominantBaseline="central"
                                                    fill={INTERACTION_BLUE}
                                                    className="font-label font-medium select-none">
                                                    {ghostNote.letterName}
                                                </text>
                                            </g>
                                        )}
                                        <InputCursor x={inputCursorPos.x} y={inputCursorPos.y} />
                                    </g>
                                )}
                            </g>
                        )),
                    )}

                    {rows.map((row, ri) => (
                        <g key={row.id} transform={`translate(0, ${layout.getYForRow(row)})`}>
                            {/* Pointer-transparent: the lines cross the clef, key and time hit boxes
                                drawn below them, and a click right on a line must still reach those. */}
                            <g className="pointer-events-none">
                                <StaffLines lines={row.staffLines} />
                            </g>

                            <Barline layout={row.openingBarline} />

                            {/* Ties are laid out in row-local coordinates; this row draws only its own segments */}
                            {layout.tieSegmentsOn(row).map(({ tie, segment }) => (
                                <Tie key={tie.note.id} segment={segment} direction={tie.direction} />
                            ))}

                            {ri === lastRowIndex && measureButtons && onAddMeasure && (
                                <MeasureButton
                                    x={measureButtons.x}
                                    y={measureButtons.addY}
                                    size={measureButtons.size}
                                    label="+"
                                    onClick={onAddMeasure}
                                />
                            )}
                            {ri === lastRowIndex && measureButtons && onRemoveMeasure && (
                                <MeasureButton
                                    x={measureButtons.x}
                                    y={measureButtons.removeY}
                                    size={measureButtons.size}
                                    label="-"
                                    onClick={onRemoveMeasure}
                                    disabled={!canRemoveMeasure}
                                />
                            )}
                        </g>
                    ))}
                </svg>
            )}
        </div>
    )
})
