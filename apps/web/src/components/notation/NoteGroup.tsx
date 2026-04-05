import { memo } from 'react'

import type { Note } from '@/model'

import { DOT_RADIUS, STEM_WIDTH } from './constants'
import { Glyph } from './Glyph'

interface NoteGroupProps {
    note: Note
    color?: string
}

export const NoteGroup = memo(
    function NoteGroup({ note, color }: NoteGroupProps) {
        const { x, y, glyphName, stem, flag, accidental, dots, ledgerLines } = note.layout

        return (
            <g>
                {/* Ledger lines (behind everything) */}
                {ledgerLines.map((ll, i) => (
                    <line key={`ledger-${i}`} x1={ll.x1} y1={ll.y1} x2={ll.x2} y2={ll.y2} stroke="#000" strokeWidth={1.5} />
                ))}

                {/* Accidental */}
                {accidental && <Glyph name={accidental.glyphName} x={accidental.x} y={accidental.y} />}

                {/* Stem */}
                {stem && (
                    <line x1={stem.x} y1={stem.y1} x2={stem.x} y2={stem.y2} stroke="#000" strokeWidth={STEM_WIDTH} />
                )}

                {/* Flag (8th, 16th notes) */}
                {flag && <Glyph name={flag.glyphName} x={flag.x} y={flag.y} />}

                {/* Augmentation dots */}
                {dots?.map((dot, i) => (
                    <circle key={`dot-${i}`} cx={dot.x} cy={dot.y} r={DOT_RADIUS} fill="#000" />
                ))}

                {/* Notehead */}
                <Glyph name={glyphName} x={x} y={y} fill={color} />
            </g>
        )
    },
    (prev, next) => prev.note.layout.id === next.note.layout.id && prev.color === next.color,
)
