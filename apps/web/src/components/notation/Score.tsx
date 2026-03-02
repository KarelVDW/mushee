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
import type { Clef, LayoutNote, ScoreInput } from './types'

/** Vertical offset from the reference Y to the teardrop tip */
const CURSOR_Y_OFFSET = 15

/** Extra width reserved for add/remove measure buttons */
const MEASURE_BUTTONS_WIDTH = 30
const MEASURE_BUTTON_SIZE = 18
const MEASURE_BUTTON_GAP = 3

const MAX_MEASURES_PER_ROW = 4

interface ScoreProps {
    input: ScoreInput
    height?: number
    selectedNoteIndex?: number
    onNoteSelect?: (noteEventIndex: number) => void
    onNoteChange?: (noteEventIndex: number, newKey: string) => void
    onAddMeasure?: () => void
    onRemoveMeasure?: () => void
    canRemoveMeasure?: boolean
}

export function Score({ input, height = 160, selectedNoteIndex, onNoteSelect, onNoteChange, onAddMeasure, onRemoveMeasure, canRemoveMeasure = true }: ScoreProps) {
    const containerRef = useRef<HTMLDivElement>(null)
    const [containerWidth, setContainerWidth] = useState(0)

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

    return (
        <div ref={containerRef} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {containerWidth > 0 && rowInputs.map((rowInput, ri) => {
                const rowOffset = rowOffsets[ri]
                const nextOffset = rowOffsets[ri + 1]
                const isLastRow = ri === rowInputs.length - 1
                const cursorInRow = selectedNoteIndex !== undefined
                    && selectedNoteIndex >= rowOffset
                    && selectedNoteIndex < nextOffset
                const rowWidth = Math.round(containerWidth * (rowInput.measures.length / MAX_MEASURES_PER_ROW))

                return (
                    <ScoreRow
                        key={ri}
                        input={rowInput}
                        width={rowWidth}
                        height={height}
                        selectedNoteIndex={cursorInRow ? selectedNoteIndex - rowOffset : undefined}
                        onNoteSelect={onNoteSelect
                            ? (localIndex) => onNoteSelect(localIndex + rowOffset)
                            : undefined}
                        onNoteChange={onNoteChange
                            ? (localIndex, newKey) => onNoteChange(localIndex + rowOffset, newKey)
                            : undefined}
                        onAddMeasure={isLastRow ? onAddMeasure : undefined}
                        onRemoveMeasure={isLastRow ? onRemoveMeasure : undefined}
                        canRemoveMeasure={isLastRow ? canRemoveMeasure : undefined}
                    />
                )
            })}
        </div>
    )
}

// ---------------------------------------------------------------------------
// ScoreRow — renders a single staff line (SVG) for one row of measures
// ---------------------------------------------------------------------------

interface ScoreRowProps {
    input: ScoreInput
    width: number
    height?: number
    selectedNoteIndex?: number
    onNoteSelect?: (noteEventIndex: number) => void
    onNoteChange?: (noteEventIndex: number, newKey: string) => void
    onAddMeasure?: () => void
    onRemoveMeasure?: () => void
    canRemoveMeasure?: boolean
}

function ScoreRow({ input, width, height = 160, selectedNoteIndex, onNoteSelect, onNoteChange, onAddMeasure, onRemoveMeasure, canRemoveMeasure = true }: ScoreRowProps) {
    const hasMeasureButtons = !!(onAddMeasure || onRemoveMeasure)
    const layoutWidth = hasMeasureButtons ? width - MEASURE_BUTTONS_WIDTH : width
    const layout = useMemo(() => computeLayout(input, layoutWidth, height), [input, layoutWidth, height])
    const svgRef = useRef<SVGSVGElement>(null)
    const [hoverY, setHoverY] = useState<number | null>(null)

    // Find the selected note(s) for cursor indicator and ghost note
    const selectedNotes = useMemo(() => {
        if (selectedNoteIndex === undefined) return null
        const allNotes: LayoutNote[] = layout.measures.flatMap((m) => m.notes)
        const selected = allNotes.filter((n) => n.noteEventIndex === selectedNoteIndex)
        if (selected.length === 0) return null
        return selected
    }, [layout, selectedNoteIndex])

    // Cursor indicator position
    const cursorPos = useMemo(() => {
        if (!selectedNotes) return null
        const noteheadWidth = getGlyphWidth('noteheadBlack')
        const x = selectedNotes[0].x + noteheadWidth / 2
        const lowestY = Math.max(...selectedNotes.map((n) => {
            let low = n.y
            if (n.stem) low = Math.max(low, n.stem.y1, n.stem.y2)
            return low
        }))
        const bottomStaffY = SPACE_ABOVE_STAFF * STAVE_LINE_DISTANCE + (NUM_STAFF_LINES - 1) * STAVE_LINE_DISTANCE
        const y = Math.max(bottomStaffY, lowestY) + CURSOR_Y_OFFSET
        return { x, y }
    }, [selectedNotes])

    // Resolve the clef for the selected note's measure
    const selectedClef = useMemo(() => {
        if (selectedNoteIndex === undefined) return 'treble'
        let lastClef = 'treble'
        for (const measure of input.measures) {
            if (measure.clef) lastClef = measure.clef
            for (const voice of measure.voices) {
                for (const note of voice.notes) {
                    void note // iterate to count
                }
            }
        }
        return lastClef
    }, [input, selectedNoteIndex])

    // Ghost note: determine if we should show it and at what snapped line
    const ghostInfo = useMemo(() => {
        if (hoverY === null || !selectedNotes) return null
        const isRest = selectedNotes[0].glyphName.startsWith('rest')
        const hoverLine = yToLine(hoverY)
        // For non-rest notes, skip if hover line equals the current note's line
        if (!isRest) {
            const currentLine = pitchToLine(
                lineToKey(yToLine(selectedNotes[0].y), selectedClef),
                selectedClef,
            )
            if (hoverLine === currentLine) return null
        }
        // Use the note's own glyph for preview, but for rests use a black notehead
        const glyphName = isRest ? 'noteheadBlack' : selectedNotes[0].glyphName
        return { line: hoverLine, x: selectedNotes[0].x, glyphName }
    }, [hoverY, selectedNotes, selectedClef])

    const clientToSvg = useCallback((clientX: number, clientY: number): { x: number; y: number } | null => {
        const svg = svgRef.current
        if (!svg) return null
        const rect = svg.getBoundingClientRect()
        return {
            x: ((clientX - rect.left) / rect.width) * width,
            y: ((clientY - rect.top) / rect.height) * layout.height,
        }
    }, [width, layout.height])

    const handleMouseMove = useCallback((e: React.MouseEvent<SVGSVGElement>) => {
        const pt = clientToSvg(e.clientX, e.clientY)
        setHoverY(pt?.y ?? null)
    }, [clientToSvg])

    const handleMouseLeave = useCallback(() => {
        setHoverY(null)
    }, [])

    const handleClick = useCallback((e: React.MouseEvent<SVGSVGElement>) => {
        const pt = clientToSvg(e.clientX, e.clientY)
        if (!pt) return

        // Find the closest note to the click position
        const allNotes = layout.measures.flatMap((m) => m.notes)
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

        // If we clicked near a note that's not currently selected, select it
        if (closestNote && closestDist < 20 && closestNote.noteEventIndex !== selectedNoteIndex) {
            onNoteSelect?.(closestNote.noteEventIndex)
            return
        }

        // Otherwise, handle ghost note pitch change
        if (!ghostInfo || selectedNoteIndex === undefined || !onNoteChange) return
        const newKey = lineToKey(ghostInfo.line, selectedClef)
        onNoteChange(selectedNoteIndex, newKey)
    }, [clientToSvg, layout.measures, selectedNoteIndex, onNoteSelect, ghostInfo, onNoteChange, selectedClef])

    // Position measure buttons after the last barline, centered on the staff
    const measureButtonPos = useMemo(() => {
        if (!hasMeasureButtons) return null
        const lastBarline = layout.barlines[layout.barlines.length - 1]
        const staffCenterY = lastBarline.y + lastBarline.height / 2
        const x = lastBarline.x + 10
        const totalHeight = MEASURE_BUTTON_SIZE * 2 + MEASURE_BUTTON_GAP
        const topY = staffCenterY - totalHeight / 2
        return { x, topY }
    }, [hasMeasureButtons, layout.barlines])

    return (
        <svg
            ref={svgRef}
            width={width}
            height={height}
            viewBox={`0 0 ${width} ${layout.height}`}
            xmlns="http://www.w3.org/2000/svg"
            onMouseMove={handleMouseMove}
            onMouseLeave={handleMouseLeave}
            onClick={handleClick}
        >
            <StaffLines lines={layout.staffLines} />

            {layout.measures.map((measure, i) => (
                <Measure key={i} layout={measure} selectedNoteIndex={selectedNoteIndex} />
            ))}

            {layout.barlines.map((barline, i) => (
                <Barline key={i} layout={barline} />
            ))}

            {cursorPos && <CursorIndicator x={cursorPos.x} y={cursorPos.y} />}

            {ghostInfo && hoverY !== null && (
                <GhostNote x={ghostInfo.x} hoverY={hoverY} glyphName={ghostInfo.glyphName} />
            )}

            {measureButtonPos && onAddMeasure && (
                <MeasureButton
                    x={measureButtonPos.x}
                    y={measureButtonPos.topY}
                    size={MEASURE_BUTTON_SIZE}
                    label="+"
                    onClick={onAddMeasure}
                />
            )}
            {measureButtonPos && onRemoveMeasure && (
                <MeasureButton
                    x={measureButtonPos.x}
                    y={measureButtonPos.topY + MEASURE_BUTTON_SIZE + MEASURE_BUTTON_GAP}
                    size={MEASURE_BUTTON_SIZE}
                    label="-"
                    onClick={onRemoveMeasure}
                    disabled={!canRemoveMeasure}
                />
            )}
        </svg>
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
