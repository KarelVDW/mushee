'use client'

import { useCallback, useMemo, useRef, useState } from 'react'

import { Barline } from './Barline'
import { NUM_STAFF_LINES, SPACE_ABOVE_STAFF, STAVE_LINE_DISTANCE } from './constants'
import { CursorIndicator } from './CursorIndicator'
import { GhostNote } from './GhostNote'
import { getGlyphWidth } from './glyph-utils'
import { computeLayout } from './layout'
import { Measure } from './Measure'
import { lineToKey, pitchToLine, yToLine } from './note-utils'
import { StaffLines } from './StaffLines'
import type { LayoutNote, ScoreInput } from './types'

/** Vertical offset from the reference Y to the teardrop tip */
const CURSOR_Y_OFFSET = 15

interface ScoreProps {
    input: ScoreInput
    width?: number
    height?: number
    selectedNoteIndex?: number
    onNoteChange?: (noteEventIndex: number, newKey: string) => void
}

export function Score({ input, width = 600, height = 160, selectedNoteIndex, onNoteChange }: ScoreProps) {
    const layout = useMemo(() => computeLayout(input, width, height), [input, width, height])
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

    const clientToSvgY = useCallback((clientY: number): number | null => {
        const svg = svgRef.current
        if (!svg) return null
        const rect = svg.getBoundingClientRect()
        // Map client Y to viewBox Y
        return ((clientY - rect.top) / rect.height) * layout.height
    }, [layout.height])

    const handleMouseMove = useCallback((e: React.MouseEvent<SVGSVGElement>) => {
        const y = clientToSvgY(e.clientY)
        setHoverY(y)
    }, [clientToSvgY])

    const handleMouseLeave = useCallback(() => {
        setHoverY(null)
    }, [])

    const handleClick = useCallback(() => {
        if (!ghostInfo || selectedNoteIndex === undefined || !onNoteChange) return
        const newKey = lineToKey(ghostInfo.line, selectedClef)
        onNoteChange(selectedNoteIndex, newKey)
    }, [ghostInfo, selectedNoteIndex, onNoteChange, selectedClef])

    return (
        <svg
            ref={svgRef}
            width={width}
            height={height}
            viewBox={`0 0 ${layout.width} ${layout.height}`}
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
        </svg>
    )
}
