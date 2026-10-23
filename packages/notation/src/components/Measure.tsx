import { memo, type PointerEvent, type ReactNode } from 'react'

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

// The full staff band, with a little air above and below: the vertical extent of both the
// selection highlight (a soft blue strip behind selected noteheads) and the click targets of
// clefs, keys and time signatures.
const STAFF_BAND_Y = Staff.TOP_Y - 6
const STAFF_BAND_HEIGHT = Staff.HEIGHT + 12
/**
 * How far each selection band reaches past its note's slot, so neighbouring bands overlap
 * instead of abutting: a run reads as one strip, with no anti-aliased seam between notes (or at
 * a barline, which draws over the overlap).
 */
const SELECTION_BAND_OVERLAP = 0.5
/** The corner radius of a lone selected note's band; a band beside a selected neighbour is square. */
const SELECTION_BAND_RADIUS = 3

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
    /**
     * A pointer that can hover (mouse, pen) entered an attribute glyph's hit box, or left it
     * (`click` null) — so the host can name what a click would change. Same coordinates as
     * {@link onAttributeClick}; only reported while that one is given.
     */
    onAttributeHover?: (measure: MeasureModel, click: AttributeClick | null, localX: number, localY: number) => void
}

interface HitBox {
    x: number
    y: number
    width: number
    height: number
}

/**
 * The hover tint of a clickable attribute glyph: its ink turns INTERACTION_BLUE (#1e90ff — a
 * class needs the literal) with a 150ms fade, on pointers that can hover. It is a stylesheet
 * rule rather than a fill attribute, so an exported snapshot never carries it.
 */
const ATTRIBUTE_HOVER_TINT =
    '[&_*]:transition-colors [&_*]:duration-150 motion-reduce:[&_*]:transition-none group-hover/attribute:[&_path]:fill-[#1e90ff] group-hover/attribute:[&_text]:fill-[#1e90ff] group-hover/attribute:[&_line]:stroke-[#1e90ff]'

/** Whether a pointer event comes from a pointer that hovers (mouse, pen) rather than a finger. */
const hovers = (e: PointerEvent) => e.pointerType !== 'touch'

/** Wraps an attribute glyph in a click target when a handler is provided — a transparent rect
 *  over the glyph's hit box makes thin glyphs comfortably clickable — that tints on hover. */
function ClickableGlyph({
    hitBox,
    onClick,
    onHover,
    children,
}: {
    hitBox: HitBox
    onClick?: () => void
    onHover?: (hovered: boolean) => void
    children: ReactNode
}) {
    if (!onClick) return <>{children}</>
    return (
        <g
            onClick={(e) => {
                e.stopPropagation()
                onClick()
            }}
            onPointerEnter={onHover && ((e) => hovers(e) && onHover(true))}
            onPointerLeave={onHover && ((e) => hovers(e) && onHover(false))}
            className="group/attribute cursor-pointer">
            <rect x={hitBox.x} y={hitBox.y} width={hitBox.width} height={hitBox.height} fill="transparent" />
            <g className={ATTRIBUTE_HOVER_TINT}>{children}</g>
        </g>
    )
}

export const Measure = memo(function Measure({
    measure,
    layout,
    selectedNoteIds,
    hoveredNoteId,
    onAttributeClick,
    onAttributeHover,
}: MeasureProps) {
    /** The hover reporter for one glyph, or none when the glyphs are inert or nobody listens. */
    const hoverFor = (click: AttributeClick, x: number, y: number) =>
        onAttributeClick && onAttributeHover ? (hovered: boolean) => onAttributeHover(measure, hovered ? click : null, x, y) : undefined
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
                            hitBox={{ x: 0, y: STAFF_BAND_Y, width, height: STAFF_BAND_HEIGHT }}
                            onClick={onAttributeClick && (() => onAttributeClick(measure, click, x, Staff.TOP_Y))}
                            onHover={hoverFor(click, x, Staff.TOP_Y)}>
                            {glyph}
                        </ClickableGlyph>
                    </g>
                )
            })}

            {measure.notes.map((note, i, notes) => {
                const isSelected = selectedNoteIds?.has(note.id) ?? false
                const isHovered = !isSelected && note.id === hoveredNoteId
                const noteLayout = layout.noteLayoutFor(note)
                const noteX = layout.getXForElement(note)
                // One band per selected note (the e2e suites count them), spanning the note's full
                // allotted slot — the last note reaching the end barline — and a hair past it, so a
                // run of selected notes reads as one continuous strip. Only a lone selected note
                // keeps soft corners; inside a run the bands meet square.
                const inRun = !!selectedNoteIds && [notes[i - 1], notes[i + 1]].some((n) => !!n && selectedNoteIds.has(n.id))
                return (
                    <g key={note.id} transform={`translate(${noteX}, 0)`}>
                        {isSelected && (
                            <rect
                                data-export-exclude
                                data-selection-band
                                x={0}
                                y={STAFF_BAND_Y}
                                width={layout.getAllottedWidth(note) + SELECTION_BAND_OVERLAP}
                                height={STAFF_BAND_HEIGHT}
                                rx={inRun ? 0 : SELECTION_BAND_RADIUS}
                                fill={INTERACTION_BLUE_BAND}
                            />
                        )}
                        <NoteGroup
                            layout={noteLayout}
                            stem={layout.stemFor(note)}
                            beamed={!!layout.beamFor(note)}
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
                const click: AttributeClick = { kind: 'tempo', beatPosition: tempo.beatPosition, bpm: tempo.bpm }
                return (
                    <g key={`tempo-${tempo.id}`} transform={`translate(${x}, 0)`}>
                        <ClickableGlyph
                            hitBox={{
                                x: -2,
                                y: y - BEAT_UNIT_STEM_HEIGHT - 2,
                                width: beatUnitWidth(pulse) + TEMPO_TEXT_HIT_WIDTH,
                                height: BEAT_UNIT_STEM_HEIGHT + 4,
                            }}
                            onClick={onAttributeClick && (() => onAttributeClick(measure, click, x, y))}
                            onHover={hoverFor(click, x, y)}>
                            <TempoMarking y={y} pulse={pulse} pulseBpm={tempo.pulseBpm} />
                        </ClickableGlyph>
                    </g>
                )
            })}
        </>
    )
})
