import type { Measure as MeasureModel } from '@/model'

import { BeamGroup } from './BeamGroup'
import { Glyph } from './Glyph'
import { NoteGroup } from './NoteGroup'
import { TimeSignature } from './TimeSignature'
import { TupletBracket } from './TupletBracket'

const CURSOR_COLOR = '#1e90ff'

interface MeasureProps {
    measure: MeasureModel
    selectedNoteId?: string
    hoveredNoteId?: string | null
}

export function Measure({ measure, selectedNoteId, hoveredNoteId }: MeasureProps) {
    const { clef, timeSignature } = measure.layout

    return (
        <g>
            {clef && <Glyph name={clef.glyphName} x={clef.x} y={clef.y} />}

            {timeSignature && <TimeSignature layout={timeSignature} />}

            {measure.notes.map((note) => {
                const isSelected = note.id === selectedNoteId
                const isHovered = !isSelected && note.id === hoveredNoteId
                return <NoteGroup key={note.id} note={note} color={isSelected || isHovered ? CURSOR_COLOR : undefined} />
            })}

            {measure.beams.map((beam, i) => (
                <BeamGroup key={i} beam={beam} />
            ))}

            {measure.tuplets.map((tuplet, i) => (
                <TupletBracket key={i} tuplet={tuplet} />
            ))}
        </g>
    )
}
