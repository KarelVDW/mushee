import { memo } from 'react'

import type { Measure as MeasureModel, Note } from '@/model'

import { Barline } from './Barline'
import { BeamGroup } from './BeamGroup'
import { Clef } from './Clef'
import { NUM_STAFF_LINES, SPACE_ABOVE_STAFF, STAVE_LINE_DISTANCE } from './constants'
import { KeySignature } from './KeySignature'
import { NoteGroup } from './NoteGroup'
import { TimeSignature } from './TimeSignature'
import { TupletBracket } from './TupletBracket'

const CURSOR_COLOR = '#1e90ff'

// Selection highlight band: a soft, rounded blue strip behind selected noteheads. Its height
// spans the staff (matching the playback cursor); adjacent selected notes' bands abut into a
// continuous run because each spans the full gap to the next note.
const SELECTION_FILL = 'rgba(30, 144, 255, 0.14)'
const SELECTION_BAND_Y = SPACE_ABOVE_STAFF * STAVE_LINE_DISTANCE - 6
const SELECTION_BAND_HEIGHT = (NUM_STAFF_LINES - 1) * STAVE_LINE_DISTANCE + 12

interface MeasureProps {
    measure: MeasureModel
    selectedNoteIds?: ReadonlySet<string>
    hoveredNote?: Note | null
    layoutId: string
}

export const Measure = memo(function Measure({ measure, selectedNoteIds, hoveredNote }: MeasureProps) {
    const layout = measure.layout
    return (
        <>
            {layout.showsClef && (
                <g transform={`translate(${layout.getXForElement(measure.clef)}, 0)`}>
                    <Clef clef={measure.clef} layoutId={measure.clef.layout.id} />
                </g>
            )}

            {/* Mid-measure clef changes — laid out as spaced elements, so notes shift to make room */}
            {measure.midMeasureClefs.map((clef) => (
                <g key={clef.id} transform={`translate(${layout.getXForElement(clef)}, 0)`}>
                    <Clef clef={clef} layoutId={clef.layout.id} />
                </g>
            ))}

            {layout.showsKeySignature && measure.keySignature.drawnAccidentals.length > 0 && (
                <g transform={`translate(${layout.getXForElement(measure.keySignature)}, 0)`}>
                    <KeySignature keySignature={measure.keySignature} layoutId={measure.keySignature.layout.id} />
                </g>
            )}

            {/* Mid-measure key changes — like mid-measure clefs, laid out so notes make room */}
            {measure.midMeasureKeySignatures.map((key) => (
                <g key={key.id} transform={`translate(${layout.getXForElement(key)}, 0)`}>
                    <KeySignature keySignature={key} layoutId={key.layout.id} />
                </g>
            ))}

            {layout.showsTimeSignature && (
                <g transform={`translate(${layout.getXForElement(measure.timeSignature)}, 0)`}>
                    <TimeSignature timeSignature={measure.timeSignature} layoutId={measure.timeSignature.layout.id} />
                </g>
            )}

            {measure.notes.map((note) => {
                const isSelected = selectedNoteIds?.has(note.id) ?? false
                const isHovered = !isSelected && note === hoveredNote
                const beam = layout.beamFor(note)
                const noteX = layout.getXForElement(note)
                // Span the band across the note's full allotted slot so a run of selected notes
                // reads as one continuous strip, with the last note reaching the end barline.
                const bandWidth = layout.getAllottedWidth(note)
                return (
                    <g key={note.id} transform={`translate(${noteX}, 0)`}>
                        {isSelected && (
                            <rect
                                x={0}
                                y={SELECTION_BAND_Y}
                                width={bandWidth}
                                height={SELECTION_BAND_HEIGHT}
                                rx={3}
                                fill={SELECTION_FILL}
                            />
                        )}
                        <NoteGroup
                            note={note}
                            beam={beam}
                            color={isSelected || isHovered ? CURSOR_COLOR : undefined}
                            layoutId={note.layout.id}
                        />
                    </g>
                )
            })}

            {layout.beams.map((beam) => (
                <BeamGroup key={beam.id} beam={beam} layoutId={beam.id} />
            ))}

            {measure.tuplets.map((tuplet, i) => (
                <TupletBracket key={i} tuplet={tuplet} layoutId={tuplet.layout.id} />
            ))}

            {layout.barline && <Barline layout={layout.barline} />}
        </>
    )
})
