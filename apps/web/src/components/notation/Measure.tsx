import { memo } from 'react'

import type { Measure as MeasureModel, Note } from '@/model'

import { BeamGroup } from './BeamGroup'
import { Clef } from './Clef'
import { NoteGroup } from './NoteGroup'
import { TimeSignature } from './TimeSignature'
import { TupletBracket } from './TupletBracket'

const CURSOR_COLOR = '#1e90ff'

interface MeasureProps {
    measure: MeasureModel
    selectedNote?: Note
    hoveredNote?: Note | null
    layoutId: string
}

export const Measure = memo(
    function Measure({ measure, selectedNote, hoveredNote }: MeasureProps) {
        return (
            <g>
                {measure.clef && <Clef clef={measure.clef} layoutId={measure.clef.layout.id} />}

                {measure.timeSignature && <TimeSignature timeSignature={measure.timeSignature} layoutId={measure.timeSignature.layout.id} />}

                {measure.notes.map((note) => {
                    const isSelected = note === selectedNote
                    const isHovered = !isSelected && note === hoveredNote
                    return <NoteGroup key={note.id} note={note} color={isSelected || isHovered ? CURSOR_COLOR : undefined} layoutId={note.layout.id} />
                })}

                {measure.beams.map((beam, i) => (
                    <BeamGroup key={i} beam={beam} layoutId={beam.layout.id} />
                ))}

                {measure.tuplets.map((tuplet, i) => (
                    <TupletBracket key={i} tuplet={tuplet} layoutId={tuplet.layout.id} />
                ))}
            </g>
        )
    },
)
