import { STEM_WIDTH } from './constants'
import { Glyph } from './Glyph'
import type { LayoutNote } from './types'

interface NoteGroupProps {
    note: LayoutNote
}

export function NoteGroup({ note }: NoteGroupProps) {
    return (
        <g>
            {/* Ledger lines (behind everything) */}
            {note.ledgerLines.map((ll, i) => (
                <line key={`ledger-${i}`} x1={ll.x1} y1={ll.y1} x2={ll.x2} y2={ll.y2} stroke="#000" strokeWidth={1} />
            ))}

            {/* Accidental */}
            {note.accidental && <Glyph name={note.accidental.glyphName} x={note.accidental.x} y={note.accidental.y} />}

            {/* Notehead */}
            <Glyph name={note.glyphName} x={note.x} y={note.y} />

            {/* Stem */}
            {note.stem && (
                <line x1={note.stem.x} y1={note.stem.y1} x2={note.stem.x} y2={note.stem.y2} stroke="#000" strokeWidth={STEM_WIDTH} />
            )}
        </g>
    )
}
