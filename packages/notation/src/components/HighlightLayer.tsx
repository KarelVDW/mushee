import type { Note } from '../model/Note'
import type { Score } from '../model/Score'
import { HIGHLIGHT_MAGENTA, NUM_STAFF_LINES, SPACE_ABOVE_STAFF, STAVE_LINE_DISTANCE } from './constants'

/**
 * Transient emphasis over part of the score — the feedback layer for the pitch operations.
 * `pulse` breathes gently while a panel is aimed at the range (the open transpose popover);
 * `flash` starts at its brightest and fades away right after an operation lands. `id` keys
 * the layer's mount, so a repeated flash over the same range restarts its animation.
 */
export interface ScoreHighlight {
    kind: 'pulse' | 'flash'
    /** The affected notes, or the whole score. */
    notes: 'all' | Note[]
    id: number
}

// A little taller than the selection bands, so the wash reads as background behind them.
const BAND_Y = SPACE_ABOVE_STAFF * STAVE_LINE_DISTANCE - 12
const BAND_HEIGHT = (NUM_STAFF_LINES - 1) * STAVE_LINE_DISTANCE + 24

const PULSE_MIN = 0.07
const PULSE_MAX = 0.16
const FLASH_START = 0.24

interface Segment {
    x: number
    y: number
    width: number
}

/**
 * Magenta wash over the highlighted range, one merged band per row. Animated with CSS
 * keyframes carried in the layer's own <style> tag, so it stays self-contained (no
 * dependence on a host stylesheet) and restarts on mount — SMIL is no good here: a
 * dynamically inserted animation runs against the SVG document's timeline, so a
 * fill="freeze" flash would land already finished. Notes from a stale range (a Score
 * that has since been swapped) simply match nothing.
 */
export function HighlightLayer({ score, highlight }: { score: Score; highlight: ScoreHighlight }) {
    const layout = score.layout
    const included = highlight.notes === 'all' ? null : new Set(highlight.notes)

    const segments: Segment[] = []
    let current: Segment | null = null
    const extend = (x: number, y: number, width: number) => {
        if (current && current.y === y && x <= current.x + current.width + 1) {
            current.width = Math.max(current.width, x + width - current.x)
        } else {
            current = { x, y, width }
            segments.push(current)
        }
    }
    for (const row of layout.rows) {
        const y = layout.getYForRow(row) + BAND_Y
        for (const measure of row.measures) {
            const measureX = row.getMeasureX(measure)
            if (!included) {
                extend(measureX, y, measure.layout.measureWidth)
                continue
            }
            for (const note of measure.notes) {
                if (!included.has(note)) continue
                extend(measureX + measure.layout.getXForElement(note), y, measure.layout.getAllottedWidth(note))
            }
        }
    }
    if (!segments.length) return null

    return (
        <g data-export-exclude data-score-highlight={highlight.kind}>
            <style>{`
                @keyframes solkey-score-pulse { from { fill-opacity: ${PULSE_MIN} } to { fill-opacity: ${PULSE_MAX} } }
                @keyframes solkey-score-flash { from { fill-opacity: ${FLASH_START} } to { fill-opacity: 0 } }
            `}</style>
            {segments.map((segment, i) => (
                <rect
                    key={i}
                    x={segment.x}
                    y={segment.y}
                    width={segment.width}
                    height={BAND_HEIGHT}
                    rx={6}
                    fill={HIGHLIGHT_MAGENTA}
                    style={
                        highlight.kind === 'pulse'
                            ? { animation: 'solkey-score-pulse 1s ease-in-out infinite alternate' }
                            : { animation: 'solkey-score-flash 0.8s ease-out forwards' }
                    }
                />
            ))}
        </g>
    )
}
