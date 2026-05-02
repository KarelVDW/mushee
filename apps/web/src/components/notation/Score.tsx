'use client'

import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { Note, Pitch, Score as ScoreModel } from '@/model'

import { Barline } from './Barline'
import { MEASURE_BUTTON_GAP, MEASURE_BUTTON_SIZE, NUM_STAFF_LINES, SCORE_WIDTH, SPACE_ABOVE_STAFF, STAVE_LINE_DISTANCE } from './constants'
import { CursorIndicator } from './CursorIndicator'
import { Measure } from './Measure'
import { MeasureButton } from './MeasureButton'
import { getLineForY } from './note-utils'
import { NoteGroup } from './NoteGroup'
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
    selectedNote?: Note | null
    playbackCursorRef?: React.RefObject<SVGRectElement | null>
    recordingWaveformRef?: React.RefObject<SVGPathElement | null>
    onNoteSelect?: (note: Note) => void
    onNoteChange?: (note: Note, newPitch: Pitch) => void
    onAddMeasure?: () => void
    onRemoveMeasure?: () => void
    canRemoveMeasure?: boolean
    onTempoChange?: (measureIndex: number, beatPosition: number, bpm: number) => void
}

export const Score = memo(function Score({
    score,
    selectedNote,
    playbackCursorRef,
    recordingWaveformRef,
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
    const [hoveredNote, setHoveredNote] = useState<Note | null>(null)
    const [ghostNote, setGhostNote] = useState<Note | null>(null)
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
    const rows = score.rows ?? []
    const totalHeight = score.layout?.totalHeight ?? 0
    const scaledHeight = containerWidth > 0 ? totalHeight * (containerWidth / SCORE_WIDTH) : 0

    // Cursor indicator position (row-local coordinates)
    const cursorPos = useMemo(() => {
        if (!selectedNote) return null
        const x = selectedNote.layout.noteX + selectedNote.width.noteHeadWidth / 2
        let lowestY = selectedNote.layout.noteY
        const stem = selectedNote.layout.stem
        if (stem) lowestY = Math.max(lowestY, stem.y1, stem.y2)
        const bottomStaffY = SPACE_ABOVE_STAFF * STAVE_LINE_DISTANCE + (NUM_STAFF_LINES - 1) * STAVE_LINE_DISTANCE
        const y = Math.max(bottomStaffY, lowestY) + CURSOR_Y_OFFSET
        return { x, y }
    }, [selectedNote])

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
                if (hoveredNote) setHoveredNote(null)
                if (ghostNote) setGhostNote(null)
                return
            }
            const row = score.layout.getRowForY(pt.y)
            if (!row) {
                if (hoveredNote) setHoveredNote(null)
                if (ghostNote) setGhostNote(null)
                return
            }
            const localY = pt.y - score.layout.getYForRow(row)
            const measure = row.layout.getMeasureForX(pt.x)
            if (!measure) {
                if (hoveredNote) setHoveredNote(null)
                if (ghostNote) setGhostNote(null)
                return
            }
            const localX = pt.x - row.layout.getMeasureX(measure)
            const note = measure.layout.getNoteForX(localX)
            if (!note) {
                if (hoveredNote) setHoveredNote(null)
                if (ghostNote) setGhostNote(null)
                return
            }
            if (note.id !== hoveredNote?.id) setHoveredNote(note)
            const hoverLine = getLineForY(localY)
            if ((hoverLine === note.pitch?.line && ghostNote) || note !== selectedNote) setGhostNote(null)
            else setGhostNote(note.clone({ pitch: Pitch.fromLine(hoverLine) }))
        },
        [clientToSvg, selectedNote],
    )

    const handleMouseLeave = useCallback(() => {
        setHoveredNote(null)
        setGhostNote(null)
    }, [])

    const handleClick = useCallback(() => {
        if (openPopover) {
            setOpenPopover(null)
            return
        }
        if (!hoveredNote) return

        if (ghostNote?.pitch && selectedNote && onNoteChange) {
            setGhostNote(null)
            onNoteChange(selectedNote, ghostNote.pitch)
            return
        }

        if (hoveredNote.id !== selectedNote?.id) {
            onNoteSelect?.(hoveredNote)
            return
        }
    }, [openPopover, onNoteSelect, onNoteChange, ghostNote, hoveredNote, selectedNote])

    // Measure button positions (last row only)
    const measureButtonPos = useMemo(() => {
        if (rows.length === 0 || !showMeasureButtons || !score.layout || !score.lastRow) return null
        const lastMeasure = score.lastRow.measures[score.lastRow.measures.length - 1]
        const barline = lastMeasure?.layout.barline
        if (!barline) return null
        const measureX = score.lastRow.layout.getMeasureX(lastMeasure)
        const staffCenterY = barline.y + barline.height / 2
        const x = measureX + barline.x + lastMeasure.barlineWidth + 10
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
                    {/* Recording waveform — painted directly by RecordingEngine via ref */}
                    <path
                        ref={recordingWaveformRef}
                        stroke="#1e3a8a"
                        strokeWidth={2.5}
                        strokeLinecap="square"
                        fill="none"
                        opacity={0.5}
                    />

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

                    {score.rows.map((row) =>
                        row.measures.map((measure) => (
                            <g
                                key={measure.id}
                                transform={`translate(${row.layout.getMeasureX(measure)}, ${score.layout.getYForRow(row)})`}>
                                <Measure
                                    measure={measure}
                                    selectedNote={selectedNote ?? undefined}
                                    hoveredNote={hoveredNote}
                                    layoutId={measure.layout.id}
                                />

                                {selectedNote && selectedNote.measure === measure && cursorPos && (
                                    <g
                                        key={`cursor-${selectedNote.id}`}
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
                                    <TempoMarking
                                        key={`tempo-${ti}`}
                                        tempo={tempo}
                                        layoutId={tempo.layout.id}
                                        onClick={() =>
                                            handleTempoClick(
                                                score.getIndexForMeasure(tempo.measure),
                                                tempo.beatPosition,
                                                tempo.bpm,
                                                row.layout.getMeasureX(tempo.measure) + tempo.measure.layout.getXForBeat(tempo.beatPosition),
                                                score.layout.getYForRow(row) + tempo.layout.y,
                                            )
                                        }
                                    />
                                ))}

                                {measure.notes.map((note) => {
                                    const tie = score.getTieByNote(note)
                                    if (!tie) return null
                                    return <Tie key={note.id} tie={tie} layoutId={tie.layout.id} rowIndex={row.index} />
                                })}
                            </g>
                        )),
                    )}

                    {rows.map((row, ri) => (
                        <g key={row.measures.map((m) => m.id).join('-')} transform={`translate(0, ${score.layout.getYForRow(row)})`}>
                            <StaffLines lines={row.layout.staffLines} />

                            <Barline layout={row.layout.openingBarline} />

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
