import { LEDGER_LINE_EXTENSION } from './constants'
import { Glyph } from './Glyph'
import { getGlyphWidth } from './glyph-utils'
import { getLedgerLinePositions, getYForNote, yToLine } from './note-utils'

interface GhostNoteProps {
    /** X position of the notehead */
    x: number
    /** Mouse Y in SVG coordinates (will be snapped to nearest note line) */
    hoverY: number
    /** Glyph name for the notehead (matches the selected note's duration) */
    glyphName: string
}

const GHOST_OPACITY = 0.35

export function GhostNote({ x, hoverY, glyphName }: GhostNoteProps) {
    const line = yToLine(hoverY)
    const snappedY = getYForNote(line, 0)
    const noteheadWidth = getGlyphWidth(glyphName)

    const ledgerLineYs = getLedgerLinePositions(line, 0)

    return (
        <g opacity={GHOST_OPACITY}>
            {ledgerLineYs.map((ly, i) => (
                <line
                    key={i}
                    x1={x - LEDGER_LINE_EXTENSION}
                    y1={ly}
                    x2={x + noteheadWidth + LEDGER_LINE_EXTENSION}
                    y2={ly}
                    stroke="#000"
                    strokeWidth={1}
                />
            ))}
            <Glyph name={glyphName} x={x} y={snappedY} />
        </g>
    )
}
