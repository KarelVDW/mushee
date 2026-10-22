import { memo, type ReactNode } from 'react'

import type { Measure as MeasureModel, Note } from '../model'
import { Clef as ClefModel } from '../model/Clef'
import { KeySignature as KeySignatureModel } from '../model/KeySignature'
import { Staff } from '../model/layout/Staff'
import { TimeSignature as TimeSignatureModel } from '../model/TimeSignature'
import { Barline } from './Barline'
import { BeamGroup } from './BeamGroup'
import { Clef } from './Clef'
import { INTERACTION_BLUE, INTERACTION_BLUE_BAND } from './constants'
import { KeySignature } from './KeySignature'
import { NoteGroup } from './NoteGroup'
import { TimeSignature } from './TimeSignature'
import { TupletBracket } from './TupletBracket'

const CURSOR_COLOR = INTERACTION_BLUE

// Selection highlight band: a soft, rounded blue strip behind selected noteheads. Its height
// spans the staff (matching the playback cursor); adjacent selected notes' bands abut into a
// continuous run because each spans the full gap to the next note.
const SELECTION_FILL = INTERACTION_BLUE_BAND
const SELECTION_BAND_Y = Staff.TOP_Y - 6
const SELECTION_BAND_HEIGHT = Staff.HEIGHT + 12

interface MeasureProps {
    measure: MeasureModel
    selectedNoteIds?: ReadonlySet<string>
    hoveredNote?: Note | null
    layoutId: string
    /** Clef / key signature glyph clicked, with the glyph's measure-local X.
     *  Omit and the glyphs render inert (read-only consumers). */
    onClefClick?: (clef: ClefModel, localX: number) => void
    onKeySignatureClick?: (keySignature: KeySignatureModel, localX: number) => void
    onTimeSignatureClick?: (timeSignature: TimeSignatureModel, localX: number) => void
}

// Hit-area vertical extent: the full staff band (matches the selection band).
const HIT_Y = Staff.TOP_Y - 6
const HIT_HEIGHT = Staff.HEIGHT + 12

/** Wraps an attribute glyph in a click target when a handler is provided — a transparent
 *  staff-height rect over the glyph's whole laid-out slot makes thin glyphs comfortably clickable. */
function ClickableGlyph({ width, onClick, children }: { width: number; onClick?: () => void; children: ReactNode }) {
    if (!onClick) return <>{children}</>
    return (
        <g
            onClick={(e) => {
                e.stopPropagation()
                onClick()
            }}
            style={{ cursor: 'pointer' }}>
            <rect x={0} y={HIT_Y} width={width} height={HIT_HEIGHT} fill="transparent" />
            {children}
        </g>
    )
}

export const Measure = memo(function Measure({
    measure,
    selectedNoteIds,
    hoveredNote,
    onClefClick,
    onKeySignatureClick,
    onTimeSignatureClick,
}: MeasureProps) {
    const layout = measure.layout
    /** The leaf glyph and click report for one drawn attribute, at its measure-local x. */
    const attribute = (element: ClefModel | KeySignatureModel | TimeSignatureModel, x: number) => {
        if (element instanceof ClefModel) {
            return { glyph: <Clef clef={element} layoutId={element.layout.id} />, onClick: onClefClick && (() => onClefClick(element, x)) }
        }
        if (element instanceof KeySignatureModel) {
            return {
                glyph: <KeySignature keySignature={element} layoutId={element.layout.id} />,
                onClick: onKeySignatureClick && (() => onKeySignatureClick(element, x)),
            }
        }
        return {
            glyph: <TimeSignature timeSignature={element} layoutId={element.layout.id} />,
            onClick: onTimeSignatureClick && (() => onTimeSignatureClick(element, x)),
        }
    }
    return (
        <>
            {/* Clefs, key and time signatures — the leading run and mid-measure changes, as laid out (notes make room) */}
            {layout.attributes.map(({ element, x, width }, i) => {
                const { glyph, onClick } = attribute(element, x)
                return (
                    <g key={element instanceof TimeSignatureModel ? `time-${i}` : element.id} transform={`translate(${x}, 0)`}>
                        <ClickableGlyph width={width} onClick={onClick}>
                            {glyph}
                        </ClickableGlyph>
                    </g>
                )
            })}

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
                                data-export-exclude
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
