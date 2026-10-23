import { memo } from 'react'

import { DOT_RADIUS, STEM_WIDTH } from '../engraving/constants'
import type { NoteLayout } from '../model/layout/NoteLayout'
import type { LayoutStem } from '../model/layout/types'
import { NOTATION_INK } from './constants'
import { Glyph } from './Glyph'

/**
 * A note landing during a recording: it fades in over 200ms, opacity only, as its waveform
 * bursts — packages/ui theme.css's `.note-land` class (the `note-land` keyframe at --t-snap,
 * --ease-solkey). The end state is the note at full opacity, so an export never shows it
 * mid-fade; under reduced motion the global rule collapses it and the note appears at once.
 */
const NOTE_LAND = 'note-land'

interface NoteGroupProps {
    /** The note's layout snapshot — the placed note in a measure, or the ghost note's NoteLayout.preview. */
    layout: NoteLayout
    /** The stem to draw: a beam's repositioned stem for a beamed note, else the layout's own (undefined for none). */
    stem: LayoutStem | undefined
    /** Beamed notes draw no flag — the beam carries the duration. */
    beamed: boolean
    color?: string
    /**
     * The note just landed in a live recording (see NoteLanding): its parts fade in together.
     * Its beam, ties and tuplet bracket are drawn elsewhere and appear at once — an opacity-only
     * fade keeps the stem on its beam throughout.
     */
    landing?: boolean
}

export const NoteGroup = memo(function NoteGroup({ layout, stem, beamed, color, landing }: NoteGroupProps) {
    const { noteX, noteY, glyphName, flag, accidental, dots, ledgerLines } = layout
    const parts = (
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
    // Only a landing note is wrapped: the engraving (and every export) keeps its flat shape.
    return landing ? <g className={NOTE_LAND}>{parts}</g> : parts
})
