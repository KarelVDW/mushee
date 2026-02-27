'use client'

import { useMemo } from 'react'

import { Barline } from './Barline'
import { NUM_STAFF_LINES, SPACE_ABOVE_STAFF, STAVE_LINE_DISTANCE } from './constants'
import { CursorIndicator } from './CursorIndicator'
import { getGlyphWidth } from './glyph-utils'
import { computeLayout } from './layout'
import { Measure } from './Measure'
import { StaffLines } from './StaffLines'
import type { LayoutNote, ScoreInput } from './types'

/** Vertical offset from the reference Y to the teardrop tip */
const CURSOR_Y_OFFSET = 15

interface ScoreProps {
    input: ScoreInput
    width?: number
    height?: number
    selectedNoteIndex?: number
}

export function Score({ input, width = 600, height = 160, selectedNoteIndex }: ScoreProps) {
    const layout = useMemo(() => computeLayout(input, width, height), [input, width, height])

    // Find the selected note(s) for cursor indicator positioning
    const cursorPos = useMemo(() => {
        if (selectedNoteIndex === undefined) return null
        const allNotes: LayoutNote[] = layout.measures.flatMap((m) => m.notes)
        const selected = allNotes.filter((n) => n.noteEventIndex === selectedNoteIndex)
        if (selected.length === 0) return null

        const noteheadWidth = getGlyphWidth('noteheadBlack')
        const x = selected[0].x + noteheadWidth / 2
        // Lowest point (highest pixel value) among note heads and stem tips
        const lowestY = Math.max(...selected.map((n) => {
            let low = n.y
            if (n.stem) low = Math.max(low, n.stem.y1, n.stem.y2)
            return low
        }))
        // Bottom staff line Y
        const bottomStaffY = SPACE_ABOVE_STAFF * STAVE_LINE_DISTANCE + (NUM_STAFF_LINES - 1) * STAVE_LINE_DISTANCE
        // Cursor sits below whichever is lower: bottom staff line, note, or stem tip
        const y = Math.max(bottomStaffY, lowestY) + CURSOR_Y_OFFSET
        return { x, y }
    }, [layout, selectedNoteIndex])

    return (
        <svg width={width} height={height} viewBox={`0 0 ${layout.width} ${layout.height}`} xmlns="http://www.w3.org/2000/svg">
            <StaffLines lines={layout.staffLines} />

            {layout.measures.map((measure, i) => (
                <Measure key={i} layout={measure} selectedNoteIndex={selectedNoteIndex} />
            ))}

            {layout.barlines.map((barline, i) => (
                <Barline key={i} layout={barline} />
            ))}

            {cursorPos && <CursorIndicator x={cursorPos.x} y={cursorPos.y} />}
        </svg>
    )
}
