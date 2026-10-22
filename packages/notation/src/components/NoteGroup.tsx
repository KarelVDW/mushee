import { memo } from 'react'

import { STEM_WIDTH } from '../engraving/constants'
import type { NoteLayout } from '../model/layout/NoteLayout'
import type { LayoutStem } from '../model/layout/types'
import { DOT_RADIUS, NOTATION_INK } from './constants'
import { Glyph } from './Glyph'

interface NoteGroupProps {
    /** The note's layout snapshot — the placed note in a measure, or the ghost note's NoteLayout.preview. */
    layout: NoteLayout
    /** The stem to draw: a beam's repositioned stem for a beamed note, else the layout's own (undefined for none). */
    stem: LayoutStem | undefined
    /** Beamed notes draw no flag — the beam carries the duration. */
    beamed: boolean
    color?: string
}

export const NoteGroup = memo(function NoteGroup({ layout, stem, beamed, color }: NoteGroupProps) {
    const { noteX, noteY, glyphName, flag, accidental, dots, ledgerLines } = layout
    return (
        <>
            {/* Ledger lines (behind everything) */}
            {ledgerLines.map((ll, i) => (
                <line key={`ledger-${i}`} x1={ll.x1} y1={ll.y1} x2={ll.x2} y2={ll.y2} stroke={NOTATION_INK} strokeWidth={1.5} />
            ))}

            {/* Accidental */}
            {accidental && <Glyph name={accidental.glyphName} x={accidental.x} y={accidental.y} />}

            {/* Stem */}
            {stem && <line x1={stem.x} y1={stem.y1} x2={stem.x} y2={stem.y2} stroke={NOTATION_INK} strokeWidth={STEM_WIDTH} />}

            {/* Flag (8th, 16th notes) */}
            {!beamed && flag && <Glyph name={flag.glyphName} x={flag.x} y={flag.y} scale={flag.scale} />}

            {/* Augmentation dots */}
            {dots?.map((dot, i) => (
                <circle key={`dot-${i}`} cx={dot.x} cy={dot.y} r={DOT_RADIUS} fill={NOTATION_INK} />
            ))}

            {/* Notehead */}
            <Glyph name={glyphName} x={noteX} y={noteY} fill={color} />
        </>
    )
})
