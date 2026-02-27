import { DOT_RADIUS, STEM_WIDTH } from './constants'
import { Glyph } from './Glyph'
import type { LayoutNote } from './types'

interface NoteGroupProps {
    note: LayoutNote
    color?: string
}

export function NoteGroup({ note, color }: NoteGroupProps) {
    return (
        <g>
            {/* Ledger lines (behind everything) */}
            {note.ledgerLines.map((ll, i) => (
                <line key={`ledger-${i}`} x1={ll.x1} y1={ll.y1} x2={ll.x2} y2={ll.y2} stroke="#000" strokeWidth={1} />
            ))}

            {/* Accidental */}
            {note.accidental && <Glyph name={note.accidental.glyphName} x={note.accidental.x} y={note.accidental.y} />}

            {/* Stem */}
            {note.stem && (
                <line x1={note.stem.x} y1={note.stem.y1} x2={note.stem.x} y2={note.stem.y2} stroke="#000" strokeWidth={STEM_WIDTH} />
            )}

            {/* Flag (8th, 16th notes) */}
            {note.flag && <Glyph name={note.flag.glyphName} x={note.flag.x} y={note.flag.y} />}

            {/* Augmentation dots */}
            {note.dots?.map((dot, i) => (
                <circle key={`dot-${i}`} cx={dot.x} cy={dot.y} r={DOT_RADIUS} fill="#000" />
            ))}

            {/* Notehead */}
            <Glyph name={note.glyphName} x={note.x} y={note.y} fill={color} />

        </g>
    )
}
