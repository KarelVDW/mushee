import {
    MAX_MEASURES_PER_ROW,
    MEASURE_BUTTON_GAP,
    MEASURE_BUTTON_OFFSET,
    MEASURE_BUTTON_SIZE,
    MEASURE_BUTTON_SPACING,
    ROW_GAP,
    ROW_HEIGHT,
    TEMPO_MARKING_Y,
} from '../../engraving/constants'
import type { Measure } from '../Measure'
import type { Note } from '../Note'
import type { Score } from '../Score'
import { MeasureLayout } from './MeasureLayout'
import { MeasureMetrics } from './MeasureMetrics'
import { RowLayout } from './RowLayout'
import { Staff } from './Staff'
import { TieLayout, type TieLayoutContext, type TieSegment } from './TieLayout'

/** Packing converges in one or two passes in practice; the cap only guards pathological oscillation. */
const MAX_PACKING_ITERATIONS = 10

/**
 * The root layout snapshot: packs measures into rows (a bounded fixed-point
 * iteration over shows-flags ↔ widths ↔ row fill), builds every measure's
 * geometry, and lays out ties. Pure function of the semantic model — nothing
 * is written back into it. Sub-layouts whose inputs are unchanged are reused
 * from the previous snapshot so memoized React subtrees stay stable.
 */
export class ScoreLayout {
    readonly id = crypto.randomUUID()
    readonly scoreWidth: number
    readonly rowGap = ROW_GAP
    readonly rowHeight = ROW_HEIGHT
    readonly rows: RowLayout[]
    readonly ties: TieLayout[]
    readonly totalHeight: number
    /**
     * The add/remove-measure buttons after the final barline, stacked around the staff's
     * middle line, in the last row's coordinates (inside the MEASURE_BUTTON_SPACING
     * reserve). Null for a score with no measures or one ending without a barline.
     */
    readonly measureButtons: { x: number; addY: number; removeY: number; size: number } | null

    private readonly _measureLayouts = new Map<Measure, MeasureLayout>()
    private readonly _rowByMeasure = new Map<Measure, RowLayout>()
    private readonly _tiesByKey = new Map<string, TieLayout>()
    private readonly _tieSegmentsByRow = new Map<number, Array<{ tie: TieLayout; segment: TieSegment }>>()

    constructor(score: Score, previous: ScoreLayout | undefined, scoreWidth: number) {
        const metrics = score.measures.map((measure, i) => new MeasureMetrics(measure, score.measures[i - 1]))

        // A measure denser than the packing budget cannot fit any row at the requested
        // width (responsive reflow can request as little as ~340). Widen the layout to
        // the densest measure instead: views render scaled-to-fit against scoreWidth,
        // so the score shrinks on screen rather than the layout failing to resolve.
        const widestMeasureMinimum = Math.max(
            0,
            ...metrics.map((m) => m.minimalWidth({ ...m.baseFlags, showsClef: true, showsKeySignature: true }, 0)),
        )
        this.scoreWidth = Math.max(scoreWidth, widestMeasureMinimum + MEASURE_BUTTON_SPACING)
        const minimumMeasureWidth = MeasureMetrics.floorFor(this.scoreWidth)

        // --- Fixed-point packing: flags → widths → rows → row-start flags, until stable ---
        let flags = metrics.map((m, i) => ({
            ...m.baseFlags,
            showsClef: i === 0 || m.baseFlags.showsClef,
            showsKeySignature: i === 0 || m.baseFlags.showsKeySignature,
        }))
        let rowGroups: number[][] = []
        for (let iteration = 0; iteration < MAX_PACKING_ITERATIONS; iteration++) {
            const widths = metrics.map((m, i) => m.minimalWidth(flags[i], minimumMeasureWidth))
            rowGroups = ScoreLayout.packGreedy(widths, this.scoreWidth)
            const next = metrics.map((m) => ({ ...m.baseFlags }))
            for (const group of rowGroups) {
                next[group[0]].showsClef = true
                next[group[0]].showsKeySignature = true
            }
            const stable = next.every(
                (f, i) =>
                    f.showsClef === flags[i].showsClef &&
                    f.showsKeySignature === flags[i].showsKeySignature &&
                    f.showsTimeSignature === flags[i].showsTimeSignature,
            )
            flags = next
            if (stable) break
        }
        const minimalWidths = metrics.map((m, i) => m.minimalWidth(flags[i], minimumMeasureWidth))

        // --- Rows (reusing unchanged ones from the previous snapshot) ---
        this.rows = rowGroups.map((group, rowIndex) => {
            const context = {
                index: rowIndex,
                isLastRow: rowIndex === rowGroups.length - 1,
                measures: group.map((i) => metrics[i].measure),
                minimalWidths: new Map(group.map((i) => [metrics[i].measure, minimalWidths[i]])),
                scoreWidth: this.scoreWidth,
            }
            const previousRow = previous?.rows[rowIndex]
            const row = previousRow?.signature === RowLayout.signatureFor(context) ? previousRow : new RowLayout(context)
            for (const measure of context.measures) this._rowByMeasure.set(measure, row)
            return row
        })
        this.totalHeight = this.rows.length * this.rowHeight + Math.max(0, this.rows.length - 1) * this.rowGap

        // --- Measure layouts (reusing those whose inputs are unchanged) ---
        metrics.forEach((m, i) => {
            const row = this._rowByMeasure.get(m.measure)
            /* v8 ignore next -- defensive: packing assigns every measure to a row */
            if (!row) return
            const context = {
                metrics: m,
                x: row.getMeasureX(m.measure),
                width: row.getMeasureWidth(m.measure),
                flags: flags[i],
            }
            const previousLayout = previous?._measureLayouts.get(m.measure)
            const layout =
                previousLayout?.signature === MeasureLayout.signatureFor(m.measure, context) ? previousLayout : new MeasureLayout(m.measure, context)
            this._measureLayouts.set(m.measure, layout)
        })

        // --- Ties (semantic pairing from the score; geometry from the endpoint layouts) ---
        this.ties = []
        for (const measure of score.measures) {
            for (const note of measure.notes) {
                const nextNote = score.tiePartner(note)
                if (!nextNote) continue
                const context = this.tieContextFor(note, nextNote)
                const key = `${note.id}|${nextNote.id}`
                const previousTie = previous?._tiesByKey.get(key)
                const tie =
                    previousTie?.signature === TieLayout.signatureFor(context) ? previousTie : new TieLayout(note, context)
                this._tiesByKey.set(key, tie)
                this.ties.push(tie)
                for (const segment of tie.segments) {
                    const onRow = this._tieSegmentsByRow.get(segment.rowIndex) ?? []
                    onRow.push({ tie, segment })
                    this._tieSegmentsByRow.set(segment.rowIndex, onRow)
                }
            }
        }

        // --- Measure buttons, in the reserve after the final barline ---
        const lastMeasure = score.measures.at(-1)
        this.measureButtons = lastMeasure ? this.measureButtonsAfter(lastMeasure) : null
    }

    private measureButtonsAfter(lastMeasure: Measure): ScoreLayout['measureButtons'] {
        const layout = this.measureLayoutFor(lastMeasure)
        if (!layout.barline) return null
        const top = Staff.MIDDLE_Y - (MEASURE_BUTTON_SIZE * 2 + MEASURE_BUTTON_GAP) / 2
        return {
            x: this.rowFor(lastMeasure).getMeasureX(lastMeasure) + layout.measureWidth + MEASURE_BUTTON_OFFSET,
            addY: top,
            removeY: top + MEASURE_BUTTON_SIZE + MEASURE_BUTTON_GAP,
            size: MEASURE_BUTTON_SIZE,
        }
    }

    private tieContextFor(note: Note, nextNote: Note): TieLayoutContext {
        const startLayout = this.measureLayoutFor(note.measure)
        const start = this.noteSpan(note)
        const end = this.noteSpan(nextNote)
        const startNoteLayout = startLayout.noteLayoutFor(note)
        const endNoteLayout = this.measureLayoutFor(nextNote.measure).noteLayoutFor(nextNote)
        const stemDir = startLayout.beamFor(note)?.stemDir ?? note.stemDir
        return {
            direction: stemDir === 'up' ? 1 : -1,
            startRowIndex: start.row.index,
            endRowIndex: end.row.index,
            startRowWidth: start.row.width,
            startX: start.x + startNoteLayout.noteRightX,
            startY: startNoteLayout.noteY,
            endX: end.x + endNoteLayout.noteX,
            endY: endNoteLayout.noteY,
        }
    }

    /** Greedy row fill, reserving measure-button space on every row while fitting (the historical budget). */
    private static packGreedy(widths: number[], scoreWidth: number): number[][] {
        const budget = RowLayout.availableWidth(scoreWidth, true)
        const groups: number[][] = []
        let current: number[] = []
        let currentWidth = 0
        for (let i = 0; i < widths.length; i++) {
            if (current.length > 0 && (current.length >= MAX_MEASURES_PER_ROW || currentWidth + widths[i] > budget)) {
                groups.push(current)
                current = []
                currentWidth = 0
            }
            current.push(i)
            currentWidth += widths[i]
        }
        if (current.length > 0) groups.push(current)
        return groups
    }

    // --- Lookups ---

    rowFor(measure: Measure): RowLayout {
        const row = this._rowByMeasure.get(measure)
        if (!row) throw new Error('Measure not part of a row')
        return row
    }

    measureLayoutFor(measure: Measure): MeasureLayout {
        const layout = this._measureLayouts.get(measure)
        if (!layout) throw new Error('Measure not part of this score layout')
        return layout
    }

    getYForRow(row: RowLayout): number {
        return row.index * (this.rowHeight + this.rowGap)
    }

    /** The tie segments drawn on `row` (row-local), each with the tie it belongs to — the same segment objects while the tie is reused. */
    tieSegmentsOn(row: RowLayout): ReadonlyArray<{ tie: TieLayout; segment: TieSegment }> {
        return this._tieSegmentsByRow.get(row.index) ?? []
    }

    getRowForY(y: number): RowLayout | undefined {
        return this.rows[Math.floor(y / (this.rowHeight + this.rowGap))]
    }

    /**
     * Where `beat` of `measure` sits on the page: its row-local x (interpolated
     * through the note slots) and the top of its row, in layout coordinates — the
     * anchor the playback and recording cursors and the recording waveform share.
     */
    pointAtBeat(measure: Measure, beat: number): { x: number; rowY: number } {
        const row = this.rowFor(measure)
        return { x: row.getMeasureX(measure) + this.measureLayoutFor(measure).getXForBeat(beat), rowY: this.getYForRow(row) }
    }

    /** The row `note` is on, and its slot there: row-local x and the width allotted to it. */
    noteSpan(note: Note): { row: RowLayout; x: number; width: number } {
        const row = this.rowFor(note.measure)
        const measureLayout = this.measureLayoutFor(note.measure)
        return {
            row,
            x: row.getMeasureX(note.measure) + measureLayout.getXForElement(note),
            width: measureLayout.getAllottedWidth(note),
        }
    }

    /**
     * Where the selection-actions menu hovers, in layout coordinates: horizontally the
     * center of the selected span on the topmost selected row (the span the selection
     * bands paint — note slots, measured with their allotted widths), vertically at that
     * row's tempo-marking height, so the menu floats above the staff the way a bpm
     * marking does. Null when no note in `notes` belongs to this layout.
     */
    selectionMenuAnchor(notes: Note[]): { x: number; y: number } | null {
        let row: RowLayout | undefined
        for (const note of notes) {
            const noteRow = this._rowByMeasure.get(note.measure)
            if (noteRow && (!row || noteRow.index < row.index)) row = noteRow
        }
        if (!row) return null
        let start = Infinity
        let end = -Infinity
        for (const note of notes) {
            if (this._rowByMeasure.get(note.measure) !== row) continue
            const span = this.noteSpan(note)
            start = Math.min(start, span.x)
            end = Math.max(end, span.x + span.width)
        }
        return { x: (start + end) / 2, y: this.getYForRow(row) + TEMPO_MARKING_Y }
    }
}
