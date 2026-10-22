import { sumBy } from 'lodash-es'

import type { Clef } from '../Clef'
import { KeySignature } from '../KeySignature'
import type { Measure } from '../Measure'
import { Note } from '../Note'
import type { Tempo } from '../Tempo'
import type { TimeSignature } from '../TimeSignature'
import type { Tuplet } from '../Tuplet'
import type { StemDirection } from '../types'
import { BarlineLayout } from './BarlineLayout'
import { BeamFinder } from './BeamFinder'
import { BeamLayout } from './BeamLayout'
import { KeySignatureLayout } from './KeySignatureLayout'
import type { MeasureFlags, MeasureMetrics } from './MeasureMetrics'
import { NoteLayout } from './NoteLayout'
import type { PhysicalWidth } from './PhysicalWidth'
import { Resizer, type Sizeable } from './Resizer'
import { TempoLayout } from './TempoLayout'
import { TupletLayout } from './TupletLayout'
import type { LayoutStem } from './types'

/** An element that occupies horizontal space within a measure. */
type MeasureElement = Clef | KeySignature | TimeSignature | Note

/** A note's share of the measure, with the mid-measure clefs/keys that ride along at its end. */
type NoteSlot = Sizeable & { element: Note; children: Array<Clef | KeySignature> }

/** A drawn clef, key signature or time signature: its measure-local x and the width it occupies. */
export interface MeasureAttribute {
    element: Clef | KeySignature | TimeSignature
    x: number
    width: number
}

export interface MeasureLayoutContext {
    /** The measure's widths and drawn forms, derived once per rebuild. */
    metrics: MeasureMetrics
    /** x of this measure within its row (row-local). */
    x: number
    width: number
    /** Which leading attributes this measure is asked to show (diff-based, plus row-start forcing). */
    flags: MeasureFlags
}

/**
 * The geometry of one measure: every element's x position and allotted width,
 * the note/key/tuplet layouts, the beams, and the end barline — all computed
 * at construction from explicit context (see ARCHITECTURE.md).
 */
export class MeasureLayout {
    readonly id = crypto.randomUUID()
    readonly measureX: number
    readonly measureWidth: number
    readonly showsClef: boolean
    /** The leading key is drawn: its flag is set (changed, or a row start) and it has something to draw — C major with nothing to cancel draws nothing. */
    readonly showsKeySignature: boolean
    readonly showsTimeSignature: boolean
    readonly barline: BarlineLayout | null
    /** Every attribute glyph drawn in this measure, left to right: the leading run, then mid-measure changes. */
    readonly attributes: ReadonlyArray<MeasureAttribute>
    readonly beams: BeamLayout[]
    /** Input signature — ScoreLayout reuses the previous instance when it is unchanged. */
    readonly signature: string

    private readonly _xMap = new Map<MeasureElement, { x: number; allottedWidth: number }>()
    private readonly _noteLayouts = new Map<Note, NoteLayout>()
    private readonly _keyLayouts = new Map<KeySignature, KeySignatureLayout>()
    private readonly _tupletLayouts = new Map<Tuplet, TupletLayout>()
    private readonly _tempoLayouts = new Map<Tempo, TempoLayout>()
    private readonly _beamByNote = new Map<Note, BeamLayout>()
    private readonly _effectiveStems = new Map<Note, { stem: LayoutStem | undefined; dir: StemDirection }>()

    constructor(
        readonly measure: Measure,
        context: MeasureLayoutContext,
    ) {
        this.measureX = context.x
        this.measureWidth = context.width
        const { metrics, flags } = context
        this.showsClef = flags.showsClef
        this.showsKeySignature = flags.showsKeySignature && metrics.leadingKeyAccidentals.length > 0
        this.showsTimeSignature = flags.showsTimeSignature
        this.signature = MeasureLayout.signatureFor(measure, context)

        const widthOf = (el: MeasureElement): PhysicalWidth => {
            if (el instanceof KeySignature) return metrics.keyWidthOf(el)
            if (el instanceof Note) return metrics.noteWidthOf(el)
            // Clefs and time signatures are context-free: their width rides on their shared layout.
            return el.layout.width
        }

        // --- Spacing: every element's x and allotted width ---
        this.attributes = this.spaceElements(measure, context, widthOf)

        // --- Barline geometry ---
        const barlineType = measure.endBarline ?? 'single'
        this.barline = barlineType === 'none' ? null : new BarlineLayout(barlineType, context.width - BarlineLayout.widthOf(barlineType))

        // --- Note layouts ---
        for (const note of measure.notes) {
            this._noteLayouts.set(note, new NoteLayout(note, { line: note.line, width: metrics.noteWidthOf(note) }))
        }

        // --- Key signature layouts (leading + mid-measure) ---
        for (const [key, width] of metrics.keyWidths) {
            const clef = measure.clefAtOrBefore(key.beatPosition)
            this._keyLayouts.set(key, new KeySignatureLayout({ clef, width }))
        }

        // --- Beams ---
        const memberContext = { xOf: (note: Note) => this.getXForElement(note), layoutOf: (note: Note) => this.noteLayoutFor(note) }
        this.beams = new BeamFinder(measure).groups.map((group) => new BeamLayout(group, memberContext))
        for (const beam of this.beams) {
            for (const note of beam.notes) this._beamByNote.set(note, beam)
        }

        // --- Effective stems: a beam repositions its members' stems and decides their direction ---
        for (const note of measure.notes) {
            const beam = this._beamByNote.get(note)
            this._effectiveStems.set(
                note,
                beam ? { stem: beam.getStem(note), dir: beam.stemDir } : { stem: this.noteLayoutFor(note).stem, dir: note.stemDir },
            )
        }

        // --- Tuplet layouts ---
        const tupletContext = {
            ...memberContext,
            stemOf: (note: Note) => this.stemFor(note),
            stemDirOf: (note: Note) => this.stemDirFor(note),
            beamOf: (note: Note) => this.beamFor(note),
        }
        for (const tuplet of measure.tuplets) {
            this._tupletLayouts.set(tuplet, new TupletLayout(tuplet, tupletContext))
        }

        // --- Tempo markings, at their beat ---
        for (const tempo of measure.tempos) {
            this._tempoLayouts.set(tempo, new TempoLayout({ x: this.getXForBeat(tempo.beatPosition) }))
        }
    }

    /**
     * Everything a measure's geometry depends on: its content (the measure's version), its slot in
     * the row, its flags, and the leading key's drawn form — the one input that depends on the
     * previous measure (a switch to C major draws the preceding key's naturals).
     */
    static signatureFor(measure: Measure, context: MeasureLayoutContext): string {
        const { flags } = context
        return [
            measure.version,
            context.x,
            context.width,
            flags.showsClef,
            flags.showsKeySignature,
            flags.showsTimeSignature,
            context.metrics.leadingKeyAccidentals.map((a) => `${a.glyphName}${a.name}${a.octave}`).join(','),
        ].join('|')
    }

    /**
     * Orders the measure's elements and records each one's x and allotted width: the leading
     * attributes first, at their natural width, then the notes merged with mid-measure changes
     * by beat (at equal beats: clefs before keys before the note). Notes share the remaining
     * width in proportion to their beats; a mid-measure clef/key rides along as a zero-allotted
     * child of the preceding note, whose minimum grows to make room. Returns the drawn
     * attributes, left to right.
     */
    private spaceElements(
        measure: Measure,
        context: MeasureLayoutContext,
        widthOf: (el: MeasureElement) => PhysicalWidth,
    ): MeasureAttribute[] {
        const leading: Array<Clef | KeySignature | TimeSignature> = []
        if (this.showsClef) leading.push(measure.clef)
        if (this.showsKeySignature) leading.push(measure.keySignature)
        if (this.showsTimeSignature) leading.push(measure.timeSignature)

        const mids: Array<{ el: Clef | KeySignature; beat: number; precedence: number }> = [
            ...measure.midMeasureClefs.map((clef) => ({ el: clef, beat: clef.beatPosition, precedence: 0 })),
            ...measure.midMeasureKeySignatures.map((key) => ({ el: key, beat: key.beatPosition, precedence: 1 })),
        ].sort((a, b) => a.beat - b.beat || a.precedence - b.precedence)

        const totalBeats = sumBy(measure.notes, (n) => n.duration.effectiveBeats)
        const contentWidth = context.width - BarlineLayout.widthOf(measure.endBarline) - sumBy(leading, (el) => widthOf(el).total)
        const widthByBeat = contentWidth / totalBeats

        const slots: NoteSlot[] = []
        /** A mid-measure clef/key rides along as a zero-allotted child of the preceding note (or joins the leading run when no note precedes it). */
        const foldIntoPrevious = (el: Clef | KeySignature) => {
            const previousSlot = slots.at(-1)
            if (previousSlot) {
                previousSlot.minimum += widthOf(el).total
                previousSlot.children.push(el)
            } else {
                leading.push(el)
            }
        }
        let mi = 0
        for (const note of measure.notes) {
            const noteBeat = measure.beatOffsetOf(note)
            while (mi < mids.length && mids[mi].beat <= noteBeat) {
                foldIntoPrevious(mids[mi].el)
                mi++
            }
            slots.push({ default: note.duration.effectiveBeats * widthByBeat, minimum: widthOf(note).total, element: note, children: [] })
        }
        while (mi < mids.length) {
            foldIntoPrevious(mids[mi].el)
            mi++
        }

        const resizer = new Resizer(slots)
        const attributes: MeasureAttribute[] = []
        let cursorX = 0
        for (const el of leading) {
            this._xMap.set(el, { x: cursorX, allottedWidth: widthOf(el).total })
            attributes.push({ element: el, x: cursorX, width: widthOf(el).total })
            cursorX += widthOf(el).total
        }
        for (const slot of slots) {
            const allottedWidth = resizer.getSize(slot)
            this._xMap.set(slot.element, { x: cursorX, allottedWidth })
            cursorX += allottedWidth
            if (slot.children.length) {
                const totalChildWidth = sumBy(slot.children, (child) => widthOf(child).total)
                cursorX -= totalChildWidth
                for (const child of slot.children) {
                    this._xMap.set(child, { x: cursorX, allottedWidth: 0 })
                    attributes.push({ element: child, x: cursorX, width: widthOf(child).total })
                    cursorX += widthOf(child).total
                }
            }
        }
        return attributes
    }

    private spacingOf(el: MeasureElement): { x: number; allottedWidth: number } {
        const spacing = this._xMap.get(el)
        if (!spacing) throw new Error('Element not spaced in measure')
        return spacing
    }

    getXForElement(el: MeasureElement): number {
        return this.spacingOf(el).x
    }

    getAllottedWidth(el: MeasureElement): number {
        return this.spacingOf(el).allottedWidth
    }

    getNoteForX(x: number): Note | null {
        for (const note of this.measure.notes) {
            const spacing = this._xMap.get(note)
            /* v8 ignore next -- defensive: every note is spaced at construction */
            if (!spacing) continue
            if (x >= spacing.x && x < spacing.x + spacing.allottedWidth) return note
        }
        return null
    }

    getXForBeat(beat: number): number {
        const notes = this.measure.notes
        const overshootIndex = notes.findIndex((el) => this.measure.beatOffsetOf(el) > beat)
        const note = overshootIndex === -1 ? notes.at(-1) : overshootIndex === 0 ? this.measure.firstNote : notes[overshootIndex - 1]
        if (!note) return 0
        const spacing = this.spacingOf(note)
        return spacing.x + (spacing.allottedWidth * (beat - this.measure.beatOffsetOf(note))) / note.duration.effectiveBeats
    }

    noteLayoutFor(note: Note): NoteLayout {
        const layout = this._noteLayouts.get(note)
        if (!layout) throw new Error('Note not part of this measure layout')
        return layout
    }

    keyLayoutFor(key: KeySignature): KeySignatureLayout {
        const layout = this._keyLayouts.get(key)
        if (!layout) throw new Error('Key signature not part of this measure layout')
        return layout
    }

    tupletLayoutFor(tuplet: Tuplet): TupletLayout {
        const layout = this._tupletLayouts.get(tuplet)
        if (!layout) throw new Error('Tuplet not part of this measure layout')
        return layout
    }

    tempoLayoutFor(tempo: Tempo): TempoLayout {
        const layout = this._tempoLayouts.get(tempo)
        if (!layout) throw new Error('Tempo not part of this measure layout')
        return layout
    }

    beamFor(note: Note): BeamLayout | undefined {
        return this._beamByNote.get(note)
    }

    /** The stem `note` is drawn with: its beam's repositioned stem, else its own (undefined for rests and whole notes). */
    stemFor(note: Note): LayoutStem | undefined {
        return this.effectiveStemOf(note).stem
    }

    /** The direction `note`'s stem points: its beam's shared direction, else its own. */
    stemDirFor(note: Note): StemDirection {
        return this.effectiveStemOf(note).dir
    }

    private effectiveStemOf(note: Note): { stem: LayoutStem | undefined; dir: StemDirection } {
        const effective = this._effectiveStems.get(note)
        if (!effective) throw new Error('Note not part of this measure layout')
        return effective
    }
}
