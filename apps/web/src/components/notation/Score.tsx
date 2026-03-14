'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { Note, Pitch, Score as ScoreModel } from '@/model'

import { Barline } from './Barline'
import { NUM_STAFF_LINES, SPACE_ABOVE_STAFF, STAVE_LINE_DISTANCE } from './constants'
import { CursorIndicator } from './CursorIndicator'
import { GhostNote } from './GhostNote'
import { getGlyphWidth } from './glyph-utils'
import { computeLayout } from './layout'
import { Measure } from './Measure'
import { xToBeat, yToLine } from './note-utils'
import { StaffLines } from './StaffLines'
import { TempoMarking } from './TempoMarking'
import { TempoPopover } from './TempoPopover'
import { Tie } from './Tie'
import type { LayoutNote } from './types'

/** Vertical offset from the reference Y to the teardrop tip */
const CURSOR_Y_OFFSET = 15

/** Extra width reserved for add/remove measure buttons */
const MEASURE_BUTTONS_WIDTH = 30
const MEASURE_BUTTON_SIZE = 18
const MEASURE_BUTTON_GAP = 3

interface ScoreProps {
    score: ScoreModel
    height?: number
    selectedNoteId?: string
    onNoteSelect?: (note: Note) => void
    onNoteChange?: (note: Note, newPitch: Pitch) => void
    onAddMeasure?: () => void
    onRemoveMeasure?: () => void
    canRemoveMeasure?: boolean
    onTempoChange?: (noteId: string, bpm: number) => void
}

export function Score({
    score,
    height = 160,
    selectedNoteId,
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
    const [openPopover, setOpenPopover] = useState<{ noteId: string; bpm: number; x: number; y: number } | null>(null)

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

    const scoreLayout = useMemo(() => {
        if (containerWidth <= 0) return null
        return computeLayout(score, containerWidth, height, {
            reserveLastRowWidth: showMeasureButtons ? MEASURE_BUTTONS_WIDTH : 0,
        })
    }, [containerWidth, score.touchedAt, height, showMeasureButtons])

    const rows = scoreLayout?.rows ?? []
    const totalHeight = scoreLayout?.totalHeight ?? 0
    const rowGap = scoreLayout?.rowGap ?? 0

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
            const layout = rows[ri]
            for (const measure of layout.measures) {
                if (measure.notes.some((n) => n.noteId === selectedNoteId)) {
                    return { rowIndex: ri }
                }
            }
        }
        return null
    }, [selectedNoteId, rows])

    // Selected notes in the cursor's row
    const selectedNotes = useMemo(() => {
        if (!cursorRowInfo || !selectedNoteId) return null
        const layout = rows[cursorRowInfo.rowIndex]
        const allNotes: LayoutNote[] = layout.measures.flatMap((m) => m.notes)
        const selected = allNotes.filter((n) => n.noteId === selectedNoteId)
        return selected.length > 0 ? selected : null
    }, [cursorRowInfo, selectedNoteId, rows])

    // Cursor indicator position (row-local coordinates)
    const cursorPos = useMemo(() => {
        if (!selectedNotes || !cursorRowInfo) return null
        const noteheadWidth = getGlyphWidth('noteheadBlack')
        const x = selectedNotes[0].x + noteheadWidth / 2
        const lowestY = Math.max(
            ...selectedNotes.map((n) => {
                let low = n.y
                if (n.stem) low = Math.max(low, n.stem.y1, n.stem.y2)
                return low
            }),
        )
        const bottomStaffY = SPACE_ABOVE_STAFF * STAVE_LINE_DISTANCE + (NUM_STAFF_LINES - 1) * STAVE_LINE_DISTANCE
        const y = Math.max(bottomStaffY, lowestY) + CURSOR_Y_OFFSET
        return { x, y, rowIndex: cursorRowInfo.rowIndex }
    }, [selectedNotes, cursorRowInfo])

    // Resolve the clef for the cursor's row
    const selectedClef = useMemo(() => {
        if (!cursorRowInfo) return 'treble'
        // const rowInput = rowInputs[cursorRowInfo.rowIndex]
        let lastClef = 'treble'
        for (const measure of score.measures) {
            if (measure.clef) lastClef = measure.clef
        }
        return lastClef
    }, [cursorRowInfo])

    // Hovered note: X → measure → beat → noteAtBeat
    const hoveredNoteId = useMemo(() => {
        if (!hoverInfo) return null
        const row = rows[hoverInfo.rowIndex]
        if (!row) return null

        // Find which layout measure contains the hover X
        const layoutMeasure = row.measures.find(
            (m) => hoverInfo.x >= m.x && hoverInfo.x < m.x + m.width,
        )
        if (!layoutMeasure || layoutMeasure.notes.length === 0) return null

        // Use actual note X range (excludes clef/time sig overhead)
        const firstNoteX = layoutMeasure.notes[0].x
        const lastNoteX = layoutMeasure.notes[layoutMeasure.notes.length - 1].x
        const noteheadWidth = getGlyphWidth('noteheadBlack')
        const beat = xToBeat(hoverInfo.x, firstNoteX, lastNoteX - firstNoteX + noteheadWidth, layoutMeasure.measure.beats)
        const note = layoutMeasure.measure.noteAtBeat(beat)
        return note?.id ?? null
    }, [hoverInfo, rows])

    // Ghost note info (row-local coordinates) — only when hovering the active note
    const ghostInfo = useMemo(() => {
        if (!hoverInfo || !selectedNotes || !cursorRowInfo) return null
        if (hoverInfo.rowIndex !== cursorRowInfo.rowIndex) return null
        if (hoveredNoteId !== selectedNoteId) return null
        const isRest = selectedNotes[0].glyphName.startsWith('rest')
        const hoverLine = yToLine(hoverInfo.y)
        if (!isRest) {
            const currentLine = Pitch.fromLine(yToLine(selectedNotes[0].y)).line
            if (hoverLine === currentLine) return null
        }
        const glyphName = isRest ? 'noteheadBlack' : selectedNotes[0].glyphName
        return { line: hoverLine, x: selectedNotes[0].x, glyphName, rowIndex: cursorRowInfo.rowIndex }
    }, [hoverInfo, selectedNotes, cursorRowInfo, selectedClef, hoveredNoteId, selectedNoteId])

    // Client to SVG coordinate conversion
    const clientToSvg = useCallback(
        (clientX: number, clientY: number): { x: number; y: number } | null => {
            const svg = svgRef.current
            if (!svg) return null
            const rect = svg.getBoundingClientRect()
            return {
                x: ((clientX - rect.left) / rect.width) * containerWidth,
                y: ((clientY - rect.top) / rect.height) * totalHeight,
            }
        },
        [containerWidth, totalHeight],
    )

    // SVG coordinate to container-relative pixel position (inverse of clientToSvg)
    const svgToContainer = useCallback(
        (svgX: number, svgY: number): { x: number; y: number } | null => {
            const svg = svgRef.current
            const container = containerRef.current
            if (!svg || !container) return null
            const svgRect = svg.getBoundingClientRect()
            const containerRect = container.getBoundingClientRect()
            const scaleX = svgRect.width / containerWidth
            const scaleY = svgRect.height / totalHeight
            return {
                x: svgRect.left + svgX * scaleX - containerRect.left,
                y: svgRect.top + svgY * scaleY - containerRect.top,
            }
        },
        [containerWidth, totalHeight],
    )

    const handleTempoClick = useCallback(
        (noteId: string, bpm: number, svgX: number, svgY: number) => {
            const pos = svgToContainer(svgX, svgY)
            if (!pos) return
            setOpenPopover({ noteId, bpm, x: pos.x, y: pos.y })
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

            // Find clicked note via beat mapping
            const layoutMeasure = row.measures.find(
                (m) => pt.x >= m.x && pt.x < m.x + m.width,
            )
            if (!layoutMeasure || layoutMeasure.notes.length === 0) return

            const firstNoteX = layoutMeasure.notes[0].x
            const lastNoteX = layoutMeasure.notes[layoutMeasure.notes.length - 1].x
            const noteheadWidth = getGlyphWidth('noteheadBlack')
            const beat = xToBeat(pt.x, firstNoteX, lastNoteX - firstNoteX + noteheadWidth, layoutMeasure.measure.beats)
            const clickedNote = layoutMeasure.measure.noteAtBeat(beat)
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
        if (rows.length === 0 || !showMeasureButtons) return null
        const lastRow = rows[rows.length - 1]
        const lastBarline = lastRow.barlines[lastRow.barlines.length - 1]
        const staffCenterY = lastBarline.y + lastBarline.height / 2
        const x = lastBarline.x + 10
        const btnTotalHeight = MEASURE_BUTTON_SIZE * 2 + MEASURE_BUTTON_GAP
        const topY = staffCenterY - btnTotalHeight / 2
        return { x, topY }
    }, [rows, showMeasureButtons])

    const lastRowIndex = rows.length - 1
    return (
        <div ref={containerRef} style={{ position: 'relative' }}>
            {containerWidth > 0 && totalHeight > 0 && (
                <svg
                    ref={svgRef}
                    width={containerWidth}
                    height={totalHeight}
                    viewBox={`0 0 ${containerWidth} ${totalHeight}`}
                    xmlns="http://www.w3.org/2000/svg"
                    onMouseMove={handleMouseMove}
                    onMouseLeave={handleMouseLeave}
                    onClick={handleClick}>
                    {rows.map((row, ri) => (
                        <g key={ri + crypto.randomUUID()} transform={`translate(0, ${rowYOffset(ri)})`}>
                            <StaffLines lines={row.staffLines} />

                            {row.measures.map((measure, mi) => (
                                <Measure key={mi} layout={measure} selectedNoteId={selectedNoteId} hoveredNoteId={hoveredNoteId} />
                            ))}

                            {row.barlines.map((barline, bi) => (
                                <Barline key={bi} layout={barline} />
                            ))}

                            {row.ties.map((tie, ti) => (
                                <Tie key={ti} layout={tie} />
                            ))}

                            {row.tempoMarkings.map((tm, ti) => (
                                <TempoMarking
                                    key={ti}
                                    x={tm.x}
                                    y={tm.y}
                                    bpm={tm.bpm}
                                    onClick={() => handleTempoClick(tm.noteId, tm.bpm, tm.x, rowYOffset(ri) + tm.y)}
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
                        onTempoChange?.(openPopover.noteId, bpm)
                        setOpenPopover(null)
                    }}
                    onDismiss={() => setOpenPopover(null)}
                />
            )}
        </div>
    )
}

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
