import { memo, type ReactNode } from 'react'

import type { Measure as MeasureModel, Note } from '../model'
import type { Clef as ClefModel } from '../model/Clef'
import type { KeySignature as KeySignatureModel } from '../model/KeySignature'
import { Barline } from './Barline'
import { BeamGroup } from './BeamGroup'
import { Clef } from './Clef'
import { GLYPH_SCALE, INTERACTION_BLUE, INTERACTION_BLUE_BAND, NUM_STAFF_LINES, SPACE_ABOVE_STAFF, STAVE_LINE_DISTANCE } from './constants'
import { getGlyphWidth } from './glyphUtils'
import { KeySignature } from './KeySignature'
import { NoteGroup } from './NoteGroup'
import { TimeSignature } from './TimeSignature'
import { TupletBracket } from './TupletBracket'

const CURSOR_COLOR = INTERACTION_BLUE

// Selection highlight band: a soft, rounded blue strip behind selected noteheads. Its height
// spans the staff (matching the playback cursor); adjacent selected notes' bands abut into a
// continuous run because each spans the full gap to the next note.
const SELECTION_FILL = INTERACTION_BLUE_BAND
const SELECTION_BAND_Y = SPACE_ABOVE_STAFF * STAVE_LINE_DISTANCE - 6
const SELECTION_BAND_HEIGHT = (NUM_STAFF_LINES - 1) * STAVE_LINE_DISTANCE + 12

interface MeasureProps {
    measure: MeasureModel
    selectedNoteIds?: ReadonlySet<string>
    hoveredNote?: Note | null
    layoutId: string
    /** Clef / key signature glyph clicked, with the glyph's measure-local X.
     *  Omit and the glyphs render inert (read-only consumers). */
    onClefClick?: (clef: ClefModel, localX: number) => void
    onKeySignatureClick?: (keySignature: KeySignatureModel, localX: number) => void
}

// Hit-area vertical extent: the full staff band (matches the selection band).
const HIT_Y = SPACE_ABOVE_STAFF * STAVE_LINE_DISTANCE - 6
const HIT_HEIGHT = (NUM_STAFF_LINES - 1) * STAVE_LINE_DISTANCE + 12

/** Wraps an attribute glyph in a click target when a handler is provided —
 *  a transparent staff-height rect makes thin glyphs comfortably clickable. */
function ClickableGlyph({ width, onClick, children }: { width: number; onClick?: () => void; children: ReactNode }) {
    if (!onClick) return <>{children}</>
    return (
        <g
            onClick={(e) => {
                e.stopPropagation()
                onClick()
            }}
            style={{ cursor: 'pointer' }}>
            <rect x={-3} y={HIT_Y} width={width + 6} height={HIT_HEIGHT} fill="transparent" />
            {children}
        </g>
    )
}

export const Measure = memo(function Measure({ measure, selectedNoteIds, hoveredNote, onClefClick, onKeySignatureClick }: MeasureProps) {
    const layout = measure.layout
    const clefWidth = (clef: ClefModel) => getGlyphWidth(clef.layout.glyphName, GLYPH_SCALE)
    const keyWidth = (key: KeySignatureModel) => {
        const accidentals = key.layout.accidentals
        if (accidentals.length === 0) return 0
        return accidentals[accidentals.length - 1].x - accidentals[0].x + getGlyphWidth(accidentals[0].glyphName, GLYPH_SCALE)
    }
    return (
        <>
            {layout.showsClef && (
                <g transform={`translate(${layout.getXForElement(measure.clef)}, 0)`}>
                    <ClickableGlyph
                        width={clefWidth(measure.clef)}
                        onClick={onClefClick && (() => onClefClick(measure.clef, layout.getXForElement(measure.clef)))}>
                        <Clef clef={measure.clef} layoutId={measure.clef.layout.id} />
                    </ClickableGlyph>
                </g>
            )}

            {/* Mid-measure clef changes — laid out as spaced elements, so notes shift to make room */}
            {measure.midMeasureClefs.map((clef) => (
                <g key={clef.id} transform={`translate(${layout.getXForElement(clef)}, 0)`}>
                    <ClickableGlyph width={clefWidth(clef)} onClick={onClefClick && (() => onClefClick(clef, layout.getXForElement(clef)))}>
                        <Clef clef={clef} layoutId={clef.layout.id} />
                    </ClickableGlyph>
                </g>
            ))}

            {layout.showsKeySignature && measure.keySignature.drawnAccidentals.length > 0 && (
                <g transform={`translate(${layout.getXForElement(measure.keySignature)}, 0)`}>
                    <ClickableGlyph
                        width={keyWidth(measure.keySignature)}
                        onClick={
                            onKeySignatureClick &&
                            (() => onKeySignatureClick(measure.keySignature, layout.getXForElement(measure.keySignature)))
                        }>
                        <KeySignature keySignature={measure.keySignature} layoutId={measure.keySignature.layout.id} />
                    </ClickableGlyph>
                </g>
            )}

            {/* Mid-measure key changes — like mid-measure clefs, laid out so notes make room */}
            {measure.midMeasureKeySignatures.map((key) => (
                <g key={key.id} transform={`translate(${layout.getXForElement(key)}, 0)`}>
                    <ClickableGlyph
                        width={keyWidth(key)}
                        onClick={onKeySignatureClick && (() => onKeySignatureClick(key, layout.getXForElement(key)))}>
                        <KeySignature keySignature={key} layoutId={key.layout.id} />
                    </ClickableGlyph>
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
