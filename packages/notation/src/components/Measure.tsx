import { memo, type ReactNode } from 'react'

import type { Measure as MeasureModel, Note } from '../model'
import { Clef as ClefModel } from '../model/Clef'
import { KeySignature as KeySignatureModel } from '../model/KeySignature'
import { Staff } from '../model/layout/Staff'
import { TimeSignature as TimeSignatureModel } from '../model/TimeSignature'
import type { ClefType } from '../model/types'
import { Barline } from './Barline'
import { BeamGroup } from './BeamGroup'
import { BEAT_UNIT_STEM_HEIGHT, beatUnitWidth } from './BeatUnit'
import { Clef } from './Clef'
import { INTERACTION_BLUE, INTERACTION_BLUE_BAND } from './constants'
import { KeySignature } from './KeySignature'
import { NoteGroup } from './NoteGroup'
import { TEMPO_TEXT_HIT_WIDTH, TempoMarking } from './TempoMarking'
import { TimeSignature } from './TimeSignature'
import { TupletBracket } from './TupletBracket'

const CURSOR_COLOR = INTERACTION_BLUE

// Selection highlight band: a soft, rounded blue strip behind selected noteheads. Its height
// spans the staff (matching the playback cursor); adjacent selected notes' bands abut into a
// continuous run because each spans the full gap to the next note.
const SELECTION_FILL = INTERACTION_BLUE_BAND
const SELECTION_BAND_Y = Staff.TOP_Y - 6
const SELECTION_BAND_HEIGHT = Staff.HEIGHT + 12

/**
 * What a clicked attribute glyph reports about itself. The score adds the measure index and
 * the click's container position to make the public AttributeClickEvent.
 */
export type AttributeClick =
    | { kind: 'tempo'; beatPosition: number; bpm: number }
    | { kind: 'clef'; clef: ClefType }
    | { kind: 'key'; fifths: number }
    | { kind: 'time'; beatAmount: number; beatType: number }

interface MeasureProps {
    measure: MeasureModel
    selectedNoteIds?: ReadonlySet<string>
    hoveredNote?: Note | null
    layoutId: string
    /**
     * A tempo marking, clef, key or time signature was clicked: what it is, plus the glyph's
     * measure-local x and the row-local y to anchor at. One stable callback serves every glyph,
     * so it never defeats the memo. Omit it and the glyphs render inert (read-only consumers).
     */
    onAttributeClick?: (measure: MeasureModel, click: AttributeClick, localX: number, localY: number) => void
}

// Hit-area vertical extent for clefs, keys and time signatures: the full staff band (matches the selection band).
const HIT_Y = Staff.TOP_Y - 6
const HIT_HEIGHT = Staff.HEIGHT + 12

interface HitBox {
    x: number
    y: number
    width: number
    height: number
}

/** Wraps an attribute glyph in a click target when a handler is provided — a transparent rect
 *  over the glyph's hit box makes thin glyphs comfortably clickable. */
function ClickableGlyph({ hitBox, onClick, children }: { hitBox: HitBox; onClick?: () => void; children: ReactNode }) {
    if (!onClick) return <>{children}</>
    return (
        <g
            onClick={(e) => {
                e.stopPropagation()
                onClick()
            }}
            style={{ cursor: 'pointer' }}>
            <rect x={hitBox.x} y={hitBox.y} width={hitBox.width} height={hitBox.height} fill="transparent" />
            {children}
        </g>
    )
}

export const Measure = memo(function Measure({ measure, selectedNoteIds, hoveredNote, onAttributeClick }: MeasureProps) {
    const layout = measure.layout
    /** The leaf glyph for one drawn attribute, and what a click on it reports. */
    const attribute = (element: ClefModel | KeySignatureModel | TimeSignatureModel): { glyph: ReactNode; click: AttributeClick } => {
        if (element instanceof ClefModel) {
            return { glyph: <Clef clef={element} layoutId={element.layout.id} />, click: { kind: 'clef', clef: element.type } }
        }
        if (element instanceof KeySignatureModel) {
            return {
                glyph: <KeySignature keySignature={element} layoutId={element.layout.id} />,
                click: { kind: 'key', fifths: element.fifths },
            }
        }
        return {
            glyph: <TimeSignature timeSignature={element} layoutId={element.layout.id} />,
            click: { kind: 'time', beatAmount: element.beatAmount, beatType: element.beatType },
        }
    }
    return (
        <>
            {/* Clefs, key and time signatures — the leading run and mid-measure changes, as laid out (notes make room).
                The hit box covers the glyph's whole laid-out slot; a click anchors at the staff top. */}
            {layout.attributes.map(({ element, x, width }, i) => {
                const { glyph, click } = attribute(element)
                return (
                    <g key={element instanceof TimeSignatureModel ? `time-${i}` : element.id} transform={`translate(${x}, 0)`}>
                        <ClickableGlyph
                            hitBox={{ x: 0, y: HIT_Y, width, height: HIT_HEIGHT }}
                            onClick={onAttributeClick && (() => onAttributeClick(measure, click, x, Staff.TOP_Y))}>
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

            {/* Tempo markings, at their beat in the headroom above the staff. The hit box spans the
                beat-unit note and reaches over the `= 90` text; a click anchors at the marking. */}
            {measure.tempos.map((tempo) => {
                const { x, y } = tempo.layout
                return (
                    <g key={`tempo-${tempo.id}`} transform={`translate(${x}, 0)`}>
                        <ClickableGlyph
                            hitBox={{
                                x: -2,
                                y: y - BEAT_UNIT_STEM_HEIGHT - 2,
                                width: beatUnitWidth(tempo.pulse) + TEMPO_TEXT_HIT_WIDTH,
                                height: BEAT_UNIT_STEM_HEIGHT + 4,
                            }}
                            onClick={
                                onAttributeClick &&
                                (() => onAttributeClick(measure, { kind: 'tempo', beatPosition: tempo.beatPosition, bpm: tempo.bpm }, x, y))
                            }>
                            <TempoMarking tempo={tempo} layoutId={tempo.layout.id} />
                        </ClickableGlyph>
                    </g>
                )
            })}
        </>
    )
})
