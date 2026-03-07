'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { Barline } from './Barline'
import { NUM_STAFF_LINES, SPACE_ABOVE_STAFF, STAVE_LINE_DISTANCE } from './constants'
import { CursorIndicator } from './CursorIndicator'
import { GhostNote } from './GhostNote'
import { getGlyphWidth } from './glyph-utils'
import { computeLayout } from './layout'
import { Measure } from './Measure'
import { lineToKey, pitchToLine, yToLine } from './note-utils'
import { StaffLines } from './StaffLines'
import { TempoMarking } from './TempoMarking'
import { TempoPopover } from './TempoPopover'
import { Tie } from './Tie'
import type { Clef, LayoutNote, ScoreInput } from './types'

/** Vertical offset from the reference Y to the teardrop tip */
const CURSOR_Y_OFFSET = 15

/** Extra width reserved for add/remove measure buttons */
const MEASURE_BUTTONS_WIDTH = 30
const MEASURE_BUTTON_SIZE = 18
const MEASURE_BUTTON_GAP = 3

const MAX_MEASURES_PER_ROW = 4
const ROW_GAP = 16

interface ScoreProps {
    input: ScoreInput
    height?: number
    selectedNoteIndex?: number
    onNoteSelect?: (noteEventIndex: number) => void
    onNoteChange?: (noteEventIndex: number, newKey: string) => void
    onAddMeasure?: () => void
    onRemoveMeasure?: () => void
    canRemoveMeasure?: boolean
    onTempoChange?: (noteEventIndex: number, bpm: number) => void
}

export function Score({ input, height = 160, selectedNoteIndex, onNoteSelect, onNoteChange, onAddMeasure, onRemoveMeasure, canRemoveMeasure = true, onTempoChange }: ScoreProps) {
    const containerRef = useRef<HTMLDivElement>(null)
    const svgRef = useRef<SVGSVGElement>(null)
    const [containerWidth, setContainerWidth] = useState(0)
    const [hoverInfo, setHoverInfo] = useState<{ rowIndex: number; y: number } | null>(null)
    const [openPopover, setOpenPopover] = useState<{ noteEventIndex: number; bpm: number; x: number; y: number } | null>(null)

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

    // Split measures into rows of max 4, injecting inherited clef on each new row
    const rowInputs = useMemo(() => {
        const rows: ScoreInput[] = []
        let lastClef: Clef | undefined
        for (let i = 0; i < input.measures.length; i += MAX_MEASURES_PER_ROW) {
            const slice = input.measures.slice(i, i + MAX_MEASURES_PER_ROW)
            const measures = slice.map((m, idx) => {
                if (idx === 0 && !m.clef && lastClef) {
                    return { ...m, clef: lastClef }
                }
                return m
            })
            for (const m of slice) {
                if (m.clef) lastClef = m.clef
            }
            rows.push({ measures })
        }
        return rows
    }, [input.measures])

    // Cumulative note event offsets per row
    const rowOffsets = useMemo(() => {
        const offsets: number[] = [0]
        for (const row of rowInputs) {
            const count = row.measures.reduce(
                (sum, m) => sum + m.voices.reduce((vSum, v) => vSum + v.notes.length, 0),
                0,
            )
            offsets.push(offsets[offsets.length - 1] + count)
        }
        return offsets
    }, [rowInputs])

    // Compute layouts for all rows
    const showMeasureButtons = !!(onAddMeasure || onRemoveMeasure)

    const rowData = useMemo(() => {
        if (containerWidth <= 0) return []
        return rowInputs.map((rowInput, ri) => {
            const isLastRow = ri === rowInputs.length - 1
            const hasMeasureButtons = isLastRow && showMeasureButtons
            const rowWidth = Math.round(containerWidth * (rowInput.measures.length / MAX_MEASURES_PER_ROW))
            const layoutWidth = hasMeasureButtons ? rowWidth - MEASURE_BUTTONS_WIDTH : rowWidth
            const layout = computeLayout(rowInput, layoutWidth, height)
            return { layout, rowWidth, hasMeasureButtons }
        })
    }, [containerWidth, rowInputs, height, showMeasureButtons])

    // Total SVG height
    const totalHeight = useMemo(() => {
        if (rowData.length === 0) return 0
        return rowData.length * height + (rowData.length - 1) * ROW_GAP
    }, [rowData.length, height])

    const rowYOffset = useCallback((ri: number) => ri * (height + ROW_GAP), [height])

    // Determine which row a Y coordinate falls in
    const yToRow = useCallback((svgY: number): { rowIndex: number; localY: number } | null => {
        for (let ri = 0; ri < rowData.length; ri++) {
            const y0 = rowYOffset(ri)
            if (svgY >= y0 && svgY < y0 + height) {
                return { rowIndex: ri, localY: svgY - y0 }
            }
        }
        return null
    }, [rowData.length, height, rowYOffset])

    // Which row contains the cursor
    const cursorRowInfo = useMemo(() => {
        if (selectedNoteIndex === undefined) return null
        for (let ri = 0; ri < rowOffsets.length - 1; ri++) {
            if (selectedNoteIndex >= rowOffsets[ri] && selectedNoteIndex < rowOffsets[ri + 1]) {
                return { rowIndex: ri, localNoteIndex: selectedNoteIndex - rowOffsets[ri] }
            }
        }
        return null
    }, [selectedNoteIndex, rowOffsets])

    // Selected notes in the cursor's row
    const selectedNotes = useMemo(() => {
        if (!cursorRowInfo || !rowData[cursorRowInfo.rowIndex]) return null
        const layout = rowData[cursorRowInfo.rowIndex].layout
        const allNotes: LayoutNote[] = layout.measures.flatMap((m) => m.notes)
        const selected = allNotes.filter((n) => n.noteEventIndex === cursorRowInfo.localNoteIndex)
        return selected.length > 0 ? selected : null
    }, [cursorRowInfo, rowData])

    // Cursor indicator position (row-local coordinates)
    const cursorPos = useMemo(() => {
        if (!selectedNotes || !cursorRowInfo) return null
        const noteheadWidth = getGlyphWidth('noteheadBlack')
        const x = selectedNotes[0].x + noteheadWidth / 2
        const lowestY = Math.max(...selectedNotes.map((n) => {
            let low = n.y
            if (n.stem) low = Math.max(low, n.stem.y1, n.stem.y2)
            return low
        }))
        const bottomStaffY = SPACE_ABOVE_STAFF * STAVE_LINE_DISTANCE + (NUM_STAFF_LINES - 1) * STAVE_LINE_DISTANCE
        const y = Math.max(bottomStaffY, lowestY) + CURSOR_Y_OFFSET
        return { x, y, rowIndex: cursorRowInfo.rowIndex }
    }, [selectedNotes, cursorRowInfo])

    // Resolve the clef for the cursor's row
    const selectedClef = useMemo(() => {
        if (!cursorRowInfo) return 'treble'
        const rowInput = rowInputs[cursorRowInfo.rowIndex]
        let lastClef = 'treble'
        for (const measure of rowInput.measures) {
            if (measure.clef) lastClef = measure.clef
        }
        return lastClef
    }, [cursorRowInfo, rowInputs])

    // Ghost note info (row-local coordinates)
    const ghostInfo = useMemo(() => {
        if (!hoverInfo || !selectedNotes || !cursorRowInfo) return null
        if (hoverInfo.rowIndex !== cursorRowInfo.rowIndex) return null
        const isRest = selectedNotes[0].glyphName.startsWith('rest')
        const hoverLine = yToLine(hoverInfo.y)
        if (!isRest) {
            const currentLine = pitchToLine(
                lineToKey(yToLine(selectedNotes[0].y), selectedClef),
                selectedClef,
            )
            if (hoverLine === currentLine) return null
        }
        const glyphName = isRest ? 'noteheadBlack' : selectedNotes[0].glyphName
        return { line: hoverLine, x: selectedNotes[0].x, glyphName, rowIndex: cursorRowInfo.rowIndex }
    }, [hoverInfo, selectedNotes, cursorRowInfo, selectedClef])

    // Client to SVG coordinate conversion
    const clientToSvg = useCallback((clientX: number, clientY: number): { x: number; y: number } | null => {
        const svg = svgRef.current
        if (!svg) return null
        const rect = svg.getBoundingClientRect()
        return {
            x: ((clientX - rect.left) / rect.width) * containerWidth,
            y: ((clientY - rect.top) / rect.height) * totalHeight,
        }
    }, [containerWidth, totalHeight])

    // SVG coordinate to container-relative pixel position (inverse of clientToSvg)
    const svgToContainer = useCallback((svgX: number, svgY: number): { x: number; y: number } | null => {
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
    }, [containerWidth, totalHeight])

    const handleTempoClick = useCallback((globalNoteEventIndex: number, bpm: number, svgX: number, svgY: number) => {
        const pos = svgToContainer(svgX, svgY)
        if (!pos) return
        setOpenPopover({ noteEventIndex: globalNoteEventIndex, bpm, x: pos.x, y: pos.y })
    }, [svgToContainer])

    const handleMouseMove = useCallback((e: React.MouseEvent<SVGSVGElement>) => {
        const pt = clientToSvg(e.clientX, e.clientY)
        if (!pt) { setHoverInfo(null); return }
        const rowInfo = yToRow(pt.y)
        if (!rowInfo) { setHoverInfo(null); return }
        setHoverInfo({ rowIndex: rowInfo.rowIndex, y: rowInfo.localY })
    }, [clientToSvg, yToRow])

    const handleMouseLeave = useCallback(() => {
        setHoverInfo(null)
    }, [])

    const handleClick = useCallback((e: React.MouseEvent<SVGSVGElement>) => {
        if (openPopover) {
            setOpenPopover(null)
            return
        }
        const pt = clientToSvg(e.clientX, e.clientY)
        if (!pt) return
        const rowInfo = yToRow(pt.y)
        if (!rowInfo) return

        const row = rowData[rowInfo.rowIndex]
        if (!row) return

        // Find closest note in this row
        const allNotes = row.layout.measures.flatMap((m) => m.notes)
        const noteheadWidth = getGlyphWidth('noteheadBlack')
        let closestNote: LayoutNote | null = null
        let closestDist = Infinity
        for (const note of allNotes) {
            const dist = Math.abs(pt.x - (note.x + noteheadWidth / 2))
            if (dist < closestDist) {
                closestDist = dist
                closestNote = note
            }
        }

        const globalOffset = rowOffsets[rowInfo.rowIndex]

        // Select note if clicked near one
        if (closestNote && closestDist < 20) {
            const globalIndex = closestNote.noteEventIndex + globalOffset
            if (globalIndex !== selectedNoteIndex) {
                onNoteSelect?.(globalIndex)
                return
            }
        }

        // Ghost note pitch change
        if (!ghostInfo || selectedNoteIndex === undefined || !onNoteChange) return
        if (ghostInfo.rowIndex !== rowInfo.rowIndex) return
        const newKey = lineToKey(ghostInfo.line, selectedClef)
        onNoteChange(selectedNoteIndex, newKey)
    }, [openPopover, clientToSvg, yToRow, rowData, rowOffsets, selectedNoteIndex, onNoteSelect, ghostInfo, onNoteChange, selectedClef])

    // Measure button positions (last row only)
    const measureButtonPos = useMemo(() => {
        if (rowData.length === 0) return null
        const lastRow = rowData[rowData.length - 1]
        if (!lastRow.hasMeasureButtons) return null
        const lastBarline = lastRow.layout.barlines[lastRow.layout.barlines.length - 1]
        const staffCenterY = lastBarline.y + lastBarline.height / 2
        const x = lastBarline.x + 10
        const btnTotalHeight = MEASURE_BUTTON_SIZE * 2 + MEASURE_BUTTON_GAP
        const topY = staffCenterY - btnTotalHeight / 2
        return { x, topY }
    }, [rowData])

    const lastRowIndex = rowData.length - 1

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
                    onClick={handleClick}
                >
                    {rowData.map((row, ri) => (
                        <g key={ri} transform={`translate(0, ${rowYOffset(ri)})`}>
                            <StaffLines lines={row.layout.staffLines} />

                            {row.layout.measures.map((measure, mi) => (
                                <Measure
                                    key={mi}
                                    layout={measure}
                                    selectedNoteIndex={cursorRowInfo?.rowIndex === ri ? cursorRowInfo.localNoteIndex : undefined}
                                />
                            ))}

                            {row.layout.barlines.map((barline, bi) => (
                                <Barline key={bi} layout={barline} />
                            ))}

                            {row.layout.ties.map((tie, ti) => (
                                <Tie key={ti} layout={tie} />
                            ))}

                            {row.layout.tempoMarkings.map((tm, ti) => {
                                const globalIndex = tm.noteEventIndex + rowOffsets[ri]
                                return (
                                    <TempoMarking
                                        key={ti}
                                        x={tm.x}
                                        y={tm.y}
                                        bpm={tm.bpm}
                                        onClick={() => handleTempoClick(globalIndex, tm.bpm, tm.x, rowYOffset(ri) + tm.y)}
                                    />
                                )
                            })}

                            {cursorPos && cursorPos.rowIndex === ri && (
                                <CursorIndicator x={cursorPos.x} y={cursorPos.y} />
                            )}

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
                        onTempoChange?.(openPopover.noteEventIndex, bpm)
                        setOpenPopover(null)
                    }}
                    onDismiss={() => setOpenPopover(null)}
                />
            )}
        </div>
    )
}

function MeasureButton({ x, y, size, label, onClick, disabled }: {
    x: number
    y: number
    size: number
    label: string
    onClick: () => void
    disabled?: boolean
}) {
    return (
        <g
            onClick={(e) => { e.stopPropagation(); if (!disabled) onClick() }}
            style={{ cursor: disabled ? 'not-allowed' : 'pointer' }}
            opacity={disabled ? 0.3 : 1}
        >
            <rect
                x={x}
                y={y}
                width={size}
                height={size}
                rx={2}
                fill="white"
                stroke="#d1d5db"
                strokeWidth={0.75}
            />
            <text
                x={x + size / 2}
                y={y + size / 2}
                textAnchor="middle"
                dominantBaseline="central"
                fontSize={size * 0.7}
                fontFamily="system-ui, sans-serif"
                fontWeight={500}
                fill="#374151"
                style={{ userSelect: 'none' }}
            >
                {label}
            </text>
        </g>
    )
}
