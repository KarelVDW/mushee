import { memo, type ReactNode } from 'react'

import type { Measure as MeasureModel } from '../model'
import { Clef as ClefModel } from '../model/Clef'
import { KeySignature as KeySignatureModel } from '../model/KeySignature'
import type { MeasureLayout } from '../model/layout/MeasureLayout'
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

// Selection highlight band: a soft, rounded blue strip behind selected noteheads. Its height
// spans the staff (matching the playback cursor); adjacent selected notes' bands abut into a
// continuous run because each spans the full gap to the next note.
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
    /**
     * The measure's layout snapshot. A rebuilt measure gets a new snapshot (an unchanged one is
     * reused), so its identity is what keeps this memo honest while the model mutates in place.
     */
    layout: MeasureLayout
    selectedNoteIds?: ReadonlySet<string>
    /** The hovered note, only when it is in this measure — hovering elsewhere leaves this memo intact. */
    hoveredNoteId?: string
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
            className="cursor-pointer">
            <rect x={hitBox.x} y={hitBox.y} width={hitBox.width} height={hitBox.height} fill="transparent" />
            {children}
        </g>
    )
}

export const Measure = memo(function Measure({ measure, layout, selectedNoteIds, hoveredNoteId, onAttributeClick }: MeasureProps) {
    /** The leaf glyph for one drawn attribute, and what a click on it reports. */
    const attribute = (element: ClefModel | KeySignatureModel | TimeSignatureModel): { glyph: ReactNode; click: AttributeClick } => {
        if (element instanceof ClefModel) {
            return { glyph: <Clef layout={element.layout} />, click: { kind: 'clef', clef: element.type } }
        }
        if (element instanceof KeySignatureModel) {
            return { glyph: <KeySignature layout={layout.keyLayoutFor(element)} />, click: { kind: 'key', fifths: element.fifths } }
        }
        return {
            glyph: <TimeSignature layout={element.layout} />,
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
                const isHovered = !isSelected && note.id === hoveredNoteId
                const noteLayout = layout.noteLayoutFor(note)
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
                                fill={INTERACTION_BLUE_BAND}
                            />
                        )}
                        <NoteGroup
                            layout={noteLayout}
                            stem={beam?.getStem(note) ?? noteLayout.stem}
                            beamed={!!beam}
                            color={isSelected || isHovered ? INTERACTION_BLUE : undefined}
                        />
                    </g>
                )
            })}

            {layout.beams.map((beam) => (
                <BeamGroup key={beam.id} beam={beam} />
            ))}

            {measure.tuplets.map((tuplet, i) => (
                <TupletBracket key={i} layout={layout.tupletLayoutFor(tuplet)} />
            ))}

            {layout.barline && <Barline layout={layout.barline} />}

            {/* Tempo markings, at their beat in the headroom above the staff. The hit box spans the
                beat-unit note and reaches over the `= 90` text; a click anchors at the marking. */}
            {measure.tempos.map((tempo) => {
                const { x, y } = layout.tempoLayoutFor(tempo)
                const pulse = tempo.pulse
                return (
                    <g key={`tempo-${tempo.id}`} transform={`translate(${x}, 0)`}>
                        <ClickableGlyph
                            hitBox={{
                                x: -2,
                                y: y - BEAT_UNIT_STEM_HEIGHT - 2,
                                width: beatUnitWidth(pulse) + TEMPO_TEXT_HIT_WIDTH,
                                height: BEAT_UNIT_STEM_HEIGHT + 4,
                            }}
                            onClick={
                                onAttributeClick &&
                                (() => onAttributeClick(measure, { kind: 'tempo', beatPosition: tempo.beatPosition, bpm: tempo.bpm }, x, y))
                            }>
                            <TempoMarking y={y} pulse={pulse} pulseBpm={tempo.pulseBpm} />
                        </ClickableGlyph>
                    </g>
                )
            })}
        </>
    )
})
