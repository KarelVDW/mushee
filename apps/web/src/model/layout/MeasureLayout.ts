import { sumBy } from 'lodash-es'

import { BARLINE_GAP, BARLINE_THICK_WIDTH, BARLINE_THIN_WIDTH, NUM_STAFF_LINES, SPACE_ABOVE_STAFF, STAVE_LINE_DISTANCE } from '@/components/notation/constants'
import type { BarlineType, LayoutBarline } from '@/components/notation/types'

import { Clef } from '../Clef'
import { KeySignature } from '../KeySignature'
import type { Measure } from '../Measure'
import { Note } from '../Note'
import type { TimeSignature } from '../TimeSignature'
import type { Tuplet } from '../Tuplet'
import { BeamFinder } from '../util/BeamFinder'
import { Resizer, type Sizeable } from '../util/Resizer'
import type { KeySignatureWidth } from '../width/KeySignatureWidth'
import type { NoteWidth } from '../width/NoteWidth'
import type { PhysicalWidth } from '../width/PhysicalWidth'
import { BeamLayout } from './BeamLayout'
import { KeySignatureLayout } from './KeySignatureLayout'
import { NoteLayout } from './NoteLayout'
import { TupletLayout } from './TupletLayout'

/** An element that occupies horizontal space within a measure. */
export type MeasureElement = Clef | KeySignature | TimeSignature | Note

export interface MeasureLayoutContext {
    /** x of this measure within its row (row-local). */
    x: number
    width: number
    rowIndex: number
    showsClef: boolean
    showsKeySignature: boolean
    showsTimeSignature: boolean
    /** Drawn accidental per note, resolved by DisplayedAccidentals. */
    accidentals: Map<Note, string | undefined>
    noteWidths: Map<Note, NoteWidth>
    /** Contextual width per drawn key signature (leading + mid-measure). */
    keyWidths: Map<KeySignature, KeySignatureWidth>
    /** Input signature for reuse comparison across ScoreLayout rebuilds. */
    reuseSignature: string
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
    readonly rowIndex: number
    readonly showsClef: boolean
    readonly showsKeySignature: boolean
    readonly showsTimeSignature: boolean
    readonly barline: LayoutBarline | null
    readonly beams: BeamLayout[]
    readonly reuseSignature: string

    private readonly _xMap = new Map<MeasureElement, { x: number; allottedWidth: number }>()
    private readonly _noteLayouts = new Map<Note, NoteLayout>()
    private readonly _keyLayouts = new Map<KeySignature, KeySignatureLayout>()
    private readonly _tupletLayouts = new Map<Tuplet, TupletLayout>()
    private readonly _beamByNote = new Map<Note, BeamLayout>()

    constructor(
        readonly measure: Measure,
        context: MeasureLayoutContext,
    ) {
        this.measureX = context.x
        this.measureWidth = context.width
        this.rowIndex = context.rowIndex
        this.showsClef = context.showsClef
        this.showsKeySignature = context.showsKeySignature
        this.showsTimeSignature = context.showsTimeSignature
        this.reuseSignature = context.reuseSignature

        const widthOf = (el: MeasureElement): PhysicalWidth => {
            if (el instanceof Clef) return el.width
            if (el instanceof KeySignature) {
                const width = context.keyWidths.get(el)
                if (!width) throw new Error('Key signature width missing from layout context')
                return width
            }
            if (el instanceof Note) {
                const width = context.noteWidths.get(el)
                if (!width) throw new Error('Note width missing from layout context')
                return width
            }
            return el.width
        }

        // --- Element order: leading context, then notes merged with mid-measure changes by beat
        // (at equal beats: clefs before keys before the note). ---
        const leading: MeasureElement[] = []
        if (context.showsClef) leading.push(measure.clef)
        if (context.showsKeySignature && measure.keySignature.drawnAccidentals.length > 0) leading.push(measure.keySignature)
        if (context.showsTimeSignature) leading.push(measure.timeSignature)

        const mids: Array<{ el: Clef | KeySignature; beat: number; precedence: number }> = [
            ...measure.midMeasureClefs.map((clef) => ({ el: clef, beat: clef.beatPosition, precedence: 0 })),
            ...measure.midMeasureKeySignatures.map((key) => ({ el: key, beat: key.beatPosition, precedence: 1 })),
        ].sort((a, b) => a.beat - b.beat || a.precedence - b.precedence)

        // --- Spacing: leading elements take their natural width; notes share the remaining
        // width proportionally to their beats; mid-measure elements ride along as zero-allotted
        // children of the preceding note (notes shift to make room via the minimum). ---
        const totalBeats = sumBy(measure.notes, (n) => n.duration.effectiveBeats)
        const contentWidth = context.width - MeasureLayout.barlineWidth(measure.endBarline) - sumBy(leading, (el) => widthOf(el).total)
        const widthByBeat = contentWidth / totalBeats

        const sizeables: Array<Sizeable & { element: Note; children: Array<Clef | KeySignature> }> = []
        let mi = 0
        for (const note of measure.notes) {
            const noteBeat = measure.beatOffsetOf(note)
            while (mi < mids.length && mids[mi].beat <= noteBeat) {
                this.foldIntoPrevious(sizeables, leading, mids[mi].el, widthOf)
                mi++
            }
            sizeables.push({
                default: note.duration.effectiveBeats * widthByBeat,
                minimum: widthOf(note).total,
                element: note,
                children: [],
            })
        }
        while (mi < mids.length) {
            this.foldIntoPrevious(sizeables, leading, mids[mi].el, widthOf)
            mi++
        }

        const resizer = new Resizer(sizeables)

        let cursorX = 0
        for (const el of leading) {
            this._xMap.set(el, { x: cursorX, allottedWidth: widthOf(el).total })
            cursorX += widthOf(el).total
        }
        for (const el of sizeables) {
            const allottedWidth = resizer.getSize(el)
            this._xMap.set(el.element, { x: cursorX, allottedWidth })
            cursorX += allottedWidth
            if (el.children.length) {
                const totalChildWidth = sumBy(el.children, (child) => widthOf(child).total)
                cursorX -= totalChildWidth
                for (const child of el.children) {
                    this._xMap.set(child, { x: cursorX, allottedWidth: 0 })
                    cursorX += widthOf(child).total
                }
            }
        }

        // --- Barline geometry ---
        const barlineType = measure.endBarline ?? 'single'
        if (barlineType === 'none') {
            this.barline = null
        } else {
            const headroom = SPACE_ABOVE_STAFF * STAVE_LINE_DISTANCE
            this.barline = {
                x: context.width - MeasureLayout.barlineWidth(measure.endBarline),
                y: headroom,
                height: (NUM_STAFF_LINES - 1) * STAVE_LINE_DISTANCE,
                type: barlineType,
            }
        }

        // --- Note layouts ---
        for (const note of measure.notes) {
            this._noteLayouts.set(note, new NoteLayout(note, { accidentalGlyph: context.accidentals.get(note), width: widthOf(note) as NoteWidth }))
        }

        // --- Key signature layouts (leading + mid-measure) ---
        for (const [key, width] of context.keyWidths) {
            const clef = measure.clefAtOrBefore(key.beatPosition)
            this._keyLayouts.set(key, new KeySignatureLayout({ clef, drawnAccidentals: key.drawnAccidentals, width }))
        }

        // --- Beams ---
        const beamContext = { xOf: (note: Note) => this.getXForElement(note), layoutOf: (note: Note) => this.noteLayoutFor(note) }
        this.beams = new BeamFinder(measure).groups.map((group) => new BeamLayout(group, beamContext))
        for (const beam of this.beams) {
            for (const note of beam.notes) this._beamByNote.set(note, beam)
        }

        // --- Tuplet layouts ---
        for (const tuplet of measure.tuplets) {
            this._tupletLayouts.set(tuplet, new TupletLayout(tuplet, beamContext))
        }
    }

    /** A mid-measure clef/key rides along as a zero-allotted child of the preceding note (or joins the leading run when no note precedes it). */
    private foldIntoPrevious(
        sizeables: Array<Sizeable & { element: Note; children: Array<Clef | KeySignature> }>,
        leading: MeasureElement[],
        el: Clef | KeySignature,
        widthOf: (el: MeasureElement) => PhysicalWidth,
    ) {
        const lastSizeable = sizeables[sizeables.length - 1]
        if (lastSizeable) {
            lastSizeable.minimum += widthOf(el).total
            lastSizeable.children.push(el)
        } else {
            leading.push(el)
        }
    }

    static barlineWidth(type: BarlineType | undefined): number {
        switch (type ?? 'single') {
            case 'none':
                return 0
            case 'single':
                return BARLINE_THIN_WIDTH
            case 'double':
                return BARLINE_THIN_WIDTH + BARLINE_GAP + BARLINE_THIN_WIDTH
            case 'end':
                return BARLINE_THIN_WIDTH + BARLINE_GAP + BARLINE_THICK_WIDTH
        }
    }

    getXForElement(el: MeasureElement): number {
        const spacing = this._xMap.get(el)
        if (!spacing) throw new Error('Element not spaced in measure')
        return spacing.x
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
        const overshootIndex = this.measure.notes.findIndex((el) => this.measure.beatOffsetOf(el) > beat)
        const note = overshootIndex === -1 ? this.measure.notes.at(-1) : this.measure.notes[overshootIndex - 1] || this.measure.firstNote
        if (!note) return 0
        const spacing = this._xMap.get(note)
        /* v8 ignore next -- defensive: every note is spaced at construction */
        if (!spacing) throw new Error('Note not spaced in measure')
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

    beamFor(note: Note): BeamLayout | undefined {
        return this._beamByNote.get(note)
    }
}
