import { memo } from 'react'

import type { Beam, Note } from '@/model'

import { DOT_RADIUS } from './constants'
import { Glyph } from './Glyph'

interface NoteGroupProps {
    note: Note
    beam?: Beam
    color?: string
    layoutId: string
}

export const NoteGroup = memo(
    function NoteGroup({ note, beam,  color }: NoteGroupProps) {
        const { noteX, noteY, glyphName, stem: originalStem, flag, accidental, dots, ledgerLines } = note.layout
        const beamStem = beam?.layout.getStem(note)
        const stem = beamStem ?? originalStem
        return (
            <>
                {/* Ledger lines (behind everything) */}
                {ledgerLines.map((ll, i) => (
                    <line key={`ledger-${i}`} x1={ll.x1} y1={ll.y1} x2={ll.x2} y2={ll.y2} stroke="#000" strokeWidth={1.5} />
                ))}

                {/* Accidental */}
                {accidental && <Glyph name={accidental.glyphName} x={accidental.x} y={accidental.y} />}

                {/* Stem */}
                {stem && (
                    <line x1={stem.x} y1={stem.y1} x2={stem.x} y2={stem.y2} stroke="#000" strokeWidth={note.width.stemWidth} />
                )}

                {/* Flag (8th, 16th notes) */}
                {!beam && flag && <Glyph name={flag.glyphName} x={flag.x} y={flag.y} scale={flag.scale} />}

                {/* Augmentation dots */}
                {dots?.map((dot, i) => (
                    <circle key={`dot-${i}`} cx={dot.x} cy={dot.y} r={DOT_RADIUS} fill="#000" />
                ))}

                {/* Notehead */}
                <Glyph name={glyphName} x={noteX} y={noteY} fill={color} />
            </>
        )
    },
)
