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
}

export const Measure = memo(
    function Measure({ measure, selectedNote, hoveredNote }: MeasureProps) {
        return (
            <g>
                {measure.clef && <Clef clef={measure.clef} />}

                {measure.timeSignature && <TimeSignature timeSignature={measure.timeSignature} />}

                {measure.notes.map((note) => {
                    const isSelected = note === selectedNote
                    const isHovered = !isSelected && note === hoveredNote
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
    },
    (prev, next) => {
        if (prev.measure.layout.id !== next.measure.layout.id) return false
        const prevHasSelected = prev.measure.hasNote(prev.selectedNote)
        const nextHasSelected = next.measure.hasNote(next.selectedNote)
        if (prevHasSelected !== nextHasSelected) return false
        if (prevHasSelected && prev.selectedNote !== next.selectedNote) return false
        const prevHasHovered = prev.measure.hasNote(prev.hoveredNote)
        const nextHasHovered = next.measure.hasNote(next.hoveredNote)
        if (prevHasHovered !== nextHasHovered) return false
        if (prevHasHovered && prev.hoveredNote !== next.hoveredNote) return false
        return true
    },
)
