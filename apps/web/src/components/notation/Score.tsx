'use client'

import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { Note, Pitch, Score as ScoreModel } from '@/model'

import { Barline } from './Barline'
import { MEASURE_BUTTON_GAP, MEASURE_BUTTON_SIZE, NUM_STAFF_LINES, SCORE_WIDTH, SPACE_ABOVE_STAFF, STAVE_LINE_DISTANCE } from './constants'
import { CursorIndicator } from './CursorIndicator'
import { GhostNote } from './GhostNote'
import { getGlyphWidth } from './glyph-utils'
import { Measure } from './Measure'
import { xToBeat, yToLine } from './note-utils'
import { StaffLines } from './StaffLines'
import { TempoMarking } from './TempoMarking'
import { TempoPopover } from './TempoPopover'
import { Tie } from './Tie'

/** Vertical offset from the reference Y to the teardrop tip */
const CURSOR_Y_OFFSET = 15

/** Extra width reserved for add/remove measure buttons */

interface ScoreProps {
    score: ScoreModel
    layoutId: string
    height?: number
    selectedNoteId?: string
    playbackCursorRef?: React.RefObject<SVGRectElement | null>
    onNoteSelect?: (note: Note) => void
    onNoteChange?: (note: Note, newPitch: Pitch) => void
    onAddMeasure?: () => void
    onRemoveMeasure?: () => void
    canRemoveMeasure?: boolean
    onTempoChange?: (measureIndex: number, beatPosition: number, bpm: number) => void
}

export const Score = memo(function Score({
    score,
    height = 160,
    selectedNoteId,
    playbackCursorRef,
    onNoteSelect,
    onNoteChange,
    onAddMeasure,
    onRemoveMeasure,
    canRemoveMeasure = true,
    onTempoChange,
}: ScoreProps) {
    const containerRef = useRef<HTMLDivElement>(null)
    const svgRef = useRef<SVGSVGElement>(null)
    const [containerWidth, setContainerWidth] = useState(0)
    const [hoverInfo, setHoverInfo] = useState<{ rowIndex: number; x: number; y: number } | null>(null)
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
            if (entry) setContainerWidth(entry.contentRect.width)
        })
        observer.observe(el)
        return () => observer.disconnect()
    }, [])

    // Compute layouts for all rows
    const showMeasureButtons = !!(onAddMeasure || onRemoveMeasure)
    const rows = score.layout?.rows ?? []
    const totalHeight = score.layout?.totalHeight ?? 0
    const rowGap = score.layout?.rowGap ?? 0
    const scaledHeight = containerWidth > 0 ? totalHeight * (containerWidth / SCORE_WIDTH) : 0

    const rowYOffset = useCallback((ri: number) => ri * (height + rowGap), [height, rowGap])

    // Determine which row a Y coordinate falls in
    const yToRow = useCallback(
        (svgY: number): { rowIndex: number; localY: number } | null => {
            for (let ri = 0; ri < rows.length; ri++) {
                const y0 = rowYOffset(ri)
                if (svgY >= y0 && svgY < y0 + height) {
                    return { rowIndex: ri, localY: svgY - y0 }
                }
            }
            return null
        },
        [rows.length, height, rowYOffset],
    )

    // Which row contains the cursor (find by noteId)
    const cursorRowInfo = useMemo(() => {
        if (!selectedNoteId) return null
        for (let ri = 0; ri < rows.length; ri++) {
            for (const measure of rows[ri].measures) {
                if (measure.notes.some((n) => n.id === selectedNoteId)) {
                    return { rowIndex: ri }
                }
            }
        }
        return null
    }, [selectedNoteId, rows])

    // Selected note model in the cursor's row
    const selectedNote = useMemo(() => {
        if (!cursorRowInfo || !selectedNoteId) return null
        const row = rows[cursorRowInfo.rowIndex]
        const allNotes = row.measures.flatMap((m) => m.notes)
        return allNotes.find((n) => n.id === selectedNoteId) ?? null
    }, [cursorRowInfo, selectedNoteId, rows])

    // Cursor indicator position (row-local coordinates)
    const cursorPos = useMemo(() => {
        if (!selectedNote || !cursorRowInfo) return null
        const noteheadWidth = getGlyphWidth('noteheadBlack')
        const x = selectedNote.layout.x + noteheadWidth / 2
        let lowestY = selectedNote.layout.y
        const stem = selectedNote.layout.stem
        if (stem) lowestY = Math.max(lowestY, stem.y1, stem.y2)
        const bottomStaffY = SPACE_ABOVE_STAFF * STAVE_LINE_DISTANCE + (NUM_STAFF_LINES - 1) * STAVE_LINE_DISTANCE
        const y = Math.max(bottomStaffY, lowestY) + CURSOR_Y_OFFSET
        return { x, y, rowIndex: cursorRowInfo.rowIndex }
    }, [selectedNote, cursorRowInfo])

    // Resolve the clef for the cursor's row
    const selectedClef = useMemo(() => {
        if (!cursorRowInfo) return 'treble'
        let lastClef = 'treble'
        for (const measure of score.measures) {
            if (measure.clef) lastClef = measure.clef.type
        }
        return lastClef
    }, [cursorRowInfo])

    // Hovered note: X → measure → beat → noteAtBeat
    const hoveredNote = useMemo(() => {
        if (!hoverInfo) return null
        const row = rows[hoverInfo.rowIndex]
        if (!row) return null

        // Find which measure contains the hover X
        const measure = row.measures.find((m) => {
            const mx = m.layout.measureX
            return hoverInfo.x >= mx && hoverInfo.x < mx + m.layout.measureWidth
        })
        if (!measure || measure.notes.length === 0) return null

        // Use actual note X range (excludes clef/time sig overhead)
        const firstNoteX = measure.notes[0].layout.x
        const lastNoteX = measure.notes[measure.notes.length - 1].layout.x
        const noteheadWidth = getGlyphWidth('noteheadBlack')
        const beat = xToBeat(hoverInfo.x, firstNoteX, lastNoteX - firstNoteX + noteheadWidth, measure.beats)
        return measure.noteAtBeat(beat)
    }, [hoverInfo, rows])

    // Ghost note info (row-local coordinates) — only when hovering the active note
    const ghostInfo = useMemo(() => {
        if (!hoverInfo || !selectedNote || !cursorRowInfo) return null
        if (hoverInfo.rowIndex !== cursorRowInfo.rowIndex) return null
        if (hoveredNote !== selectedNote) return null
        const isRest = selectedNote.isRest
        const hoverLine = yToLine(hoverInfo.y)
        if (!isRest) {
            const currentLine = Pitch.fromLine(yToLine(selectedNote.layout.y)).line
            if (hoverLine === currentLine) return null
        }
        const glyphName = isRest ? 'noteheadBlack' : selectedNote.layout.glyphName
        return { line: hoverLine, x: selectedNote.layout.x, glyphName, rowIndex: cursorRowInfo.rowIndex }
    }, [hoverInfo, selectedNote, cursorRowInfo, selectedClef, hoveredNote])

    // Client to SVG coordinate conversion
    const clientToSvg = useCallback(
        (clientX: number, clientY: number): { x: number; y: number } | null => {
            const svg = svgRef.current
            if (!svg) return null
            const rect = svg.getBoundingClientRect()
            return {
                x: ((clientX - rect.left) / rect.width) * SCORE_WIDTH,
                y: ((clientY - rect.top) / rect.height) * totalHeight,
            }
        },
        [totalHeight],
    )

    // SVG coordinate to container-relative pixel position (inverse of clientToSvg)
    const svgToContainer = useCallback(
        (svgX: number, svgY: number): { x: number; y: number } | null => {
            const svg = svgRef.current
            const container = containerRef.current
            if (!svg || !container) return null
            const svgRect = svg.getBoundingClientRect()
            const containerRect = container.getBoundingClientRect()
            const scaleX = svgRect.width / SCORE_WIDTH
            const scaleY = svgRect.height / totalHeight
            return {
                x: svgRect.left + svgX * scaleX - containerRect.left,
                y: svgRect.top + svgY * scaleY - containerRect.top,
            }
        },
        [totalHeight],
    )

    const handleTempoClick = useCallback(
        (measureIndex: number, beatPosition: number, bpm: number, svgX: number, svgY: number) => {
            const pos = svgToContainer(svgX, svgY)
            if (!pos) return
            setOpenPopover({ measureIndex, beatPosition, bpm, x: pos.x, y: pos.y })
        },
        [svgToContainer],
    )

    const handleMouseMove = useCallback(
        (e: React.MouseEvent<SVGSVGElement>) => {
            const pt = clientToSvg(e.clientX, e.clientY)
            if (!pt) {
                setHoverInfo(null)
                return
            }
            const rowInfo = yToRow(pt.y)
            if (!rowInfo) {
                setHoverInfo(null)
                return
            }
            setHoverInfo({ rowIndex: rowInfo.rowIndex, x: pt.x, y: rowInfo.localY })
        },
        [clientToSvg, yToRow],
    )

    const handleMouseLeave = useCallback(() => {
        setHoverInfo(null)
    }, [])

    const handleClick = useCallback(
        (e: React.MouseEvent<SVGSVGElement>) => {
            if (openPopover) {
                setOpenPopover(null)
                return
            }
            const pt = clientToSvg(e.clientX, e.clientY)
            if (!pt) return
            const rowInfo = yToRow(pt.y)
            if (!rowInfo) return

            const row = rows[rowInfo.rowIndex]
            if (!row) return

            // Find clicked measure via layout position
            const measure = row.measures.find((m) => {
                const mx = m.layout.measureX
                return pt.x >= mx && pt.x < mx + m.layout.measureWidth
            })
            if (!measure || measure.notes.length === 0) return

            const firstNoteX = measure.notes[0].layout.x
            const lastNoteX = measure.notes[measure.notes.length - 1].layout.x
            const noteheadWidth = getGlyphWidth('noteheadBlack')
            const beat = xToBeat(pt.x, firstNoteX, lastNoteX - firstNoteX + noteheadWidth, measure.beats)
            const clickedNote = measure.noteAtBeat(beat)
            if (!clickedNote) return

            if (clickedNote.id !== selectedNoteId) {
                onNoteSelect?.(clickedNote)
                return
            }

            // Ghost note pitch change
            if (!ghostInfo || !onNoteChange) return
            if (ghostInfo.rowIndex !== rowInfo.rowIndex) return
            const newKey = Pitch.fromLine(ghostInfo.line /* , selectedClef */)
            onNoteChange(clickedNote, newKey)
        },
        [openPopover, clientToSvg, yToRow, rows, selectedNoteId, onNoteSelect, ghostInfo, onNoteChange, selectedClef],
    )

    // Measure button positions (last row only)
    const measureButtonPos = useMemo(() => {
        if (rows.length === 0 || !showMeasureButtons || !score.layout) return null
        const lastRow = rows[rows.length - 1]
        const barlines = lastRow.barlines
        const lastBarline = barlines[barlines.length - 1]
        if (!lastBarline) return null
        const staffCenterY = lastBarline.y + lastBarline.height / 2
        const x = lastBarline.x + 10
        const btnTotalHeight = MEASURE_BUTTON_SIZE * 2 + MEASURE_BUTTON_GAP
        const topY = staffCenterY - btnTotalHeight / 2
        return { x, topY }
    }, [rows, showMeasureButtons, score.layout])

    const lastRowIndex = rows.length - 1
    return (
        <div ref={containerRef} style={{ position: 'relative' }}>
            {containerWidth > 0 && totalHeight > 0 && score.layout && (
                <svg
                    ref={svgRef}
                    width={containerWidth}
                    height={scaledHeight}
                    viewBox={`0 0 ${SCORE_WIDTH} ${totalHeight}`}
                    xmlns="http://www.w3.org/2000/svg"
                    onMouseMove={handleMouseMove}
                    onMouseLeave={handleMouseLeave}
                    onClick={handleClick}>
                    {/* Playback cursor — positioned directly by PlaybackEngine via ref */}
                    <rect
                        ref={playbackCursorRef}
                        display="none"
                        y={SPACE_ABOVE_STAFF * STAVE_LINE_DISTANCE - 5}
                        width={3}
                        height={(NUM_STAFF_LINES - 1) * STAVE_LINE_DISTANCE + 10}
                        fill="#3b82f6"
                        rx={1.5}
                    />

                    {rows.map((row, ri) => (
                        <g key={row.measures.map((m) => m.index).join('-')} transform={`translate(0, ${rowYOffset(ri)})`}>
                            <StaffLines lines={row.staffLines} />

                            {row.measures.map((measure) => (
                                <Measure
                                    key={measure.index}
                                    measure={measure}
                                    selectedNote={selectedNote ?? undefined}
                                    hoveredNote={hoveredNote}
                                    layoutId={measure.layout.id}
                                />
                            ))}

                            {row.barlines.map((barline, bi) => (
                                <Barline key={bi} layout={barline} />
                            ))}

                            {row.measures
                                .flatMap((m) => m.notes)
                                .map((note) => {
                                    const tie = note.tieToNext
                                    if (!tie) return null
                                    return <Tie key={note.id} tie={tie} layoutId={tie.layout.id} />
                                })}

                            {row.measures
                                .flatMap((m) => m.tempos)
                                .map((tempo, ti) => (
                                    <TempoMarking
                                        key={`tempo-${ti}`}
                                        tempo={tempo}
                                        layoutId={tempo.layout.id}
                                        onClick={() =>
                                            handleTempoClick(
                                                tempo.measure.index,
                                                tempo.beatPosition,
                                                tempo.bpm,
                                                tempo.layout.x,
                                                rowYOffset(ri) + tempo.layout.y,
                                            )
                                        }
                                    />
                                ))}

                            {cursorPos && cursorPos.rowIndex === ri && <CursorIndicator x={cursorPos.x} y={cursorPos.y} />}

                            {ghostInfo && ghostInfo.rowIndex === ri && hoverInfo !== null && (
                                <GhostNote x={ghostInfo.x} hoverY={hoverInfo.y} glyphName={ghostInfo.glyphName} />
                            )}

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

function MeasureButton({
    x,
    y,
    size,
    label,
    onClick,
    disabled,
}: {
    x: number
    y: number
    size: number
    label: string
    onClick: () => void
    disabled?: boolean
}) {
    return (
        <g
            onClick={(e) => {
                e.stopPropagation()
                if (!disabled) onClick()
            }}
            style={{ cursor: disabled ? 'not-allowed' : 'pointer' }}
            opacity={disabled ? 0.3 : 1}>
            <rect x={x} y={y} width={size} height={size} rx={2} fill="white" stroke="#d1d5db" strokeWidth={0.75} />
            <text
                x={x + size / 2}
                y={y + size / 2}
                textAnchor="middle"
                dominantBaseline="central"
                fontSize={size * 0.7}
                fontFamily="system-ui, sans-serif"
                fontWeight={500}
                fill="#374151"
                style={{ userSelect: 'none' }}>
                {label}
            </text>
        </g>
    )
}
