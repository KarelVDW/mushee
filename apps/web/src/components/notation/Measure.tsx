import { memo } from 'react'

import type { Measure as MeasureModel, Note } from '@/model'

import { Barline } from './Barline'
import { BeamGroup } from './BeamGroup'
import { Clef } from './Clef'
import { KeySignature } from './KeySignature'
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

export const Measure = memo(function Measure({ measure, selectedNote, hoveredNote }: MeasureProps) {
    return (
        <>
            {measure.showsClef && (
                <g transform={`translate(${measure.layout.getXForElement(measure.clef)}, 0)`}>
                    <Clef clef={measure.clef} layoutId={measure.clef.layout.id} />
                </g>
            )}

            {/* Mid-measure clef changes — laid out as physical elements, so notes shift to make room */}
            {measure.midMeasureClefs.map((clef) => (
                <g key={clef.id} transform={`translate(${measure.layout.getXForElement(clef)}, 0)`}>
                    <Clef clef={clef} layoutId={clef.layout.id} />
                </g>
            ))}

            {measure.showsKeySignature && measure.keySignature.drawnAccidentals.length > 0 && (
                <g transform={`translate(${measure.layout.getXForElement(measure.keySignature)}, 0)`}>
                    <KeySignature keySignature={measure.keySignature} layoutId={measure.keySignature.layout.id} />
                </g>
            )}

            {/* Mid-measure key changes — like mid-measure clefs, laid out so notes make room */}
            {measure.midMeasureKeySignatures.map((key) => (
                <g key={key.id} transform={`translate(${measure.layout.getXForElement(key)}, 0)`}>
                    <KeySignature keySignature={key} layoutId={key.layout.id} />
                </g>
            ))}

            {measure.showsTimeSignature && (
                <g transform={`translate(${measure.layout.getXForElement(measure.timeSignature)}, 0)`}>
                    <TimeSignature timeSignature={measure.timeSignature} layoutId={measure.timeSignature.layout.id} />
                </g>
            )}

            {measure.notes.map((note) => {
                const isSelected = note === selectedNote
                const isHovered = !isSelected && note === hoveredNote
                const beam = measure.beamOf(note)
                return (
                    <g key={note.id} transform={`translate(${measure.layout.getXForElement(note)}, 0)`}>
                        <NoteGroup
                            note={note}
                            beam={beam}
                            color={isSelected || isHovered ? CURSOR_COLOR : undefined}
                            layoutId={note.layout.id}
                        />
                    </g>
                )
            })}

            {measure.beams.map((beam, i) => (
                <BeamGroup key={i} beam={beam} layoutId={beam.layout.id} />
            ))}

            {measure.tuplets.map((tuplet, i) => (
                <TupletBracket key={i} tuplet={tuplet} layoutId={tuplet.layout.id} />
            ))}

            {measure.layout.barline && <Barline layout={measure.layout.barline} />}
        </>
    )
})
