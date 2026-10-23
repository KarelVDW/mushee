import {
    INPUT_CURSOR_TAIL,
    MAX_MEASURES_PER_ROW,
    MEASURE_BUTTON_GAP,
    MEASURE_BUTTON_OFFSET,
    MEASURE_BUTTON_SIZE,
    MEASURE_BUTTON_SPACING,
    ROW_GAP,
    ROW_HEIGHT,
    STAVE_LINE_DISTANCE,
    TEMPO_MARKING_Y,
} from '../../engraving/constants'
import type { Measure } from '../Measure'
import type { Note } from '../Note'
import type { Score } from '../Score'
import { MeasureLayout } from './MeasureLayout'
import { type MeasureFlags, MeasureMetrics } from './MeasureMetrics'
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
     *
     * `inkBottom` is the last row's lowest ink, in the same coordinates — what a host's own bar
     * controls under the row keep clear of: the bottom staff line, or whatever reaches below
     * it (a low notehead and its ledger lines, a down-stem as drawn), and the input cursor's
     * room under every note, since any of them can be selected.
     */
    readonly measureButtons: { x: number; addY: number; removeY: number; size: number; inkBottom: number } | null

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
        const widestMeasureMinimum = Math.max(0, ...metrics.map((m) => m.minimalWidth(ScoreLayout.asRowStart(m.baseFlags), 0)))
        this.scoreWidth = Math.max(scoreWidth, widestMeasureMinimum + MEASURE_BUTTON_SPACING)

        const { rowGroups, flags, minimalWidths } = ScoreLayout.packRows(metrics, this.scoreWidth, MeasureMetrics.floorFor(this.scoreWidth))

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
                previousLayout?.signature === MeasureLayout.signatureFor(m.measure, context)
                    ? previousLayout
                    : new MeasureLayout(m.measure, context)
            this._measureLayouts.set(m.measure, layout)
        })

        this.ties = this.buildTies(score, previous)

        // --- Measure buttons, in the reserve after the final barline ---
        const lastMeasure = score.measures.at(-1)
        this.measureButtons = lastMeasure ? this.measureButtonsAfter(lastMeasure) : null
    }

    private measureButtonsAfter(lastMeasure: Measure): ScoreLayout['measureButtons'] {
        const layout = this.measureLayoutFor(lastMeasure)
        if (!layout.barline) return null
        const top = Staff.MIDDLE_Y - (MEASURE_BUTTON_SIZE * 2 + MEASURE_BUTTON_GAP) / 2
        const row = this.rowFor(lastMeasure)
        return {
            x: row.getMeasureX(lastMeasure) + layout.measureWidth + MEASURE_BUTTON_OFFSET,
            addY: top,
            removeY: top + MEASURE_BUTTON_SIZE + MEASURE_BUTTON_GAP,
            size: MEASURE_BUTTON_SIZE,
            inkBottom: this.inkBottomOf(row),
        }
    }

    /** The lowest ink on `row`, row-local: see {@link measureButtons}' `inkBottom`. */
    private inkBottomOf(row: RowLayout): number {
        let bottom = Staff.TOP_Y + Staff.HEIGHT // the bottom staff line
        for (const measure of row.measures) {
            const layout = this.measureLayoutFor(measure)
            for (const note of measure.notes) {
                const noteLayout = layout.noteLayoutFor(note)
                const { noteY, ledgerLines } = noteLayout
                const drawn = layout.stemFor(note)
                bottom = Math.max(
                    bottom,
                    noteY + STAVE_LINE_DISTANCE / 2, // the notehead's lower edge
                    ...ledgerLines.map((line) => line.y1),
                    drawn ? Math.max(drawn.y1, drawn.y2) : noteY,
                    // The input cursor's teardrop, hung where ScoreView draws it when the note is selected.
                    noteLayout.inputCursor.y + INPUT_CURSOR_TAIL,
                )
            }
        }
        return bottom
    }

    /** Ties: the semantic pairing from the score, geometry from the endpoint layouts (reusing unchanged ones). */
    private buildTies(score: Score, previous: ScoreLayout | undefined): TieLayout[] {
        const ties: TieLayout[] = []
        for (const measure of score.measures) {
            for (const note of measure.notes) {
                const nextNote = score.tiePartner(note)
                if (!nextNote) continue
                const context = this.tieContextFor(note, nextNote)
                const key = `${note.id}|${nextNote.id}`
                const previousTie = previous?._tiesByKey.get(key)
                const tie = previousTie?.signature === TieLayout.signatureFor(context) ? previousTie : new TieLayout(note, context)
                this._tiesByKey.set(key, tie)
                ties.push(tie)
                for (const segment of tie.segments) {
                    const onRow = this._tieSegmentsByRow.get(segment.rowIndex) ?? []
                    onRow.push({ tie, segment })
                    this._tieSegmentsByRow.set(segment.rowIndex, onRow)
                }
            }
        }
        return ties
    }

    private tieContextFor(note: Note, nextNote: Note): TieLayoutContext {
        const startLayout = this.measureLayoutFor(note.measure)
        const start = this.noteSpan(note)
        const end = this.noteSpan(nextNote)
        const startNoteLayout = startLayout.noteLayoutFor(note)
        const endNoteLayout = this.measureLayoutFor(nextNote.measure).noteLayoutFor(nextNote)
        const stemDir = startLayout.stemDirFor(note)
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

    /**
     * Packs measures into rows — a fixed point over flags → widths → rows → row-start flags:
     * a measure that starts a row draws its clef and key, which widens it, which can move the
     * row breaks. Iterates until the row starts stop changing. Out of iterations, it keeps the
     * flags the rows were packed with, so every row still fits its budget (no ResizeError); the
     * price, in that pathological case only, is that a measure the last pass moved to a row
     * start may lack its forced clef/key.
     */
    private static packRows(
        metrics: MeasureMetrics[],
        scoreWidth: number,
        floor: number,
    ): { rowGroups: number[][]; flags: MeasureFlags[]; minimalWidths: number[] } {
        let flags = metrics.map((m, i) => (i === 0 ? ScoreLayout.asRowStart(m.baseFlags) : m.baseFlags))
        for (let iteration = 1; ; iteration++) {
            const minimalWidths = metrics.map((m, i) => m.minimalWidth(flags[i], floor))
            const rowGroups = ScoreLayout.packGreedy(minimalWidths, scoreWidth)
            const rowStarts = new Set(rowGroups.map((group) => group[0]))
            const next = metrics.map((m, i) => (rowStarts.has(i) ? ScoreLayout.asRowStart(m.baseFlags) : m.baseFlags))
            // Only the clef and key flags move with row starts; the time signature is diff-based alone.
            const stable = next.every((f, i) => f.showsClef === flags[i].showsClef && f.showsKeySignature === flags[i].showsKeySignature)
            if (stable || iteration === MAX_PACKING_ITERATIONS) return { rowGroups, flags, minimalWidths }
            flags = next
        }
    }

    /** A row start redraws the clef and key in effect. */
    private static asRowStart(flags: MeasureFlags): MeasureFlags {
        return { ...flags, showsClef: true, showsKeySignature: true }
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

    /** Vertical distance from one row's top to the next: a row plus the gap below it. */
    get rowStride(): number {
        return this.rowHeight + this.rowGap
    }

    getYForRow(row: RowLayout): number {
        return row.index * this.rowStride
    }

    /** The tie segments drawn on `row` (row-local), each with the tie it belongs to — the same segment objects while the tie is reused. */
    tieSegmentsOn(row: RowLayout): ReadonlyArray<{ tie: TieLayout; segment: TieSegment }> {
        return this._tieSegmentsByRow.get(row.index) ?? []
    }

    getRowForY(y: number): RowLayout | undefined {
        return this.rows[Math.floor(y / this.rowStride)]
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
