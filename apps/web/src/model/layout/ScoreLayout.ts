import { sumBy } from 'lodash-es'

import { MAX_MEASURES_PER_ROW, ROW_GAP, ROW_HEIGHT, SCORE_WIDTH } from '@/components/notation/constants'

import type { KeySignature } from '../KeySignature'
import type { Measure } from '../Measure'
import type { Note } from '../Note'
import type { Score } from '../Score'
import { KeySignatureWidth } from '../width/KeySignatureWidth'
import { NoteWidth } from '../width/NoteWidth'
import { DisplayedAccidentals } from './DisplayedAccidentals'
import { MeasureLayout } from './MeasureLayout'
import { RowLayout } from './RowLayout'
import { availableRowWidth } from './rowWidth'
import { TieLayout, type TieLayoutContext } from './TieLayout'

/** Packing converges in one or two passes in practice; the cap only guards pathological oscillation. */
const MAX_PACKING_ITERATIONS = 10

/** A measure narrower than this is padded up — prevents unusably cramped bars. */
function absoluteMinimumWidth(scoreWidth: number): number {
    return scoreWidth / (MAX_MEASURES_PER_ROW + 1)
}

interface MeasureFlags {
    showsClef: boolean
    showsKeySignature: boolean
    showsTimeSignature: boolean
}

/** Per-measure layout inputs derived once per rebuild from the semantic model. */
interface MeasurePlan {
    measure: Measure
    accidentals: Map<Note, string | undefined>
    noteWidths: Map<Note, NoteWidth>
    keyWidths: Map<KeySignature, KeySignatureWidth>
    leadingKeyWidth: KeySignatureWidth
    /** Width of elements present regardless of flags: mid-measure changes, notes, barline. */
    fixedWidth: number
    /** Diff-based flags (vs the previous measure); row starts are forced on top during packing. */
    base: MeasureFlags
    /** Signature of the leading key's drawn accidentals — the one layout input that depends on the *previous* measure. */
    leadingKeyDrawnSignature: string
}

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

    private readonly _measureLayouts = new Map<Measure, MeasureLayout>()
    private readonly _rowByMeasure = new Map<Measure, RowLayout>()
    private readonly _tiesByKey = new Map<string, TieLayout>()

    constructor(score: Score, previous?: ScoreLayout, scoreWidth: number = SCORE_WIDTH) {
        this.scoreWidth = scoreWidth
        const minimumMeasureWidth = absoluteMinimumWidth(scoreWidth)
        const plans = ScoreLayout.buildPlans(score)

        // --- Fixed-point packing: flags → widths → rows → row-start flags, until stable ---
        let flags = plans.map((plan, i) => ({
            ...plan.base,
            showsClef: i === 0 || plan.base.showsClef,
            showsKeySignature: i === 0 || plan.base.showsKeySignature,
        }))
        let rowGroups: number[][] = []
        for (let iteration = 0; iteration < MAX_PACKING_ITERATIONS; iteration++) {
            const widths = plans.map((plan, i) => ScoreLayout.minimalWidth(plan, flags[i], minimumMeasureWidth))
            rowGroups = ScoreLayout.packGreedy(widths, scoreWidth)
            const next = plans.map((plan) => ({ ...plan.base }))
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
        const minimalWidths = plans.map((plan, i) => ScoreLayout.minimalWidth(plan, flags[i], minimumMeasureWidth))

        // --- Rows (reusing unchanged ones from the previous snapshot) ---
        this.rows = rowGroups.map((group, rowIndex) => {
            const context = {
                index: rowIndex,
                isLastRow: rowIndex === rowGroups.length - 1,
                measures: group.map((i) => plans[i].measure),
                minimalWidths: new Map(group.map((i) => [plans[i].measure, minimalWidths[i]])),
                scoreWidth,
            }
            const previousRow = previous?.rows[rowIndex]
            const row = previousRow?.matches(context) ? previousRow : new RowLayout(context)
            for (const measure of context.measures) this._rowByMeasure.set(measure, row)
            return row
        })
        this.totalHeight = this.rows.length * this.rowHeight + Math.max(0, this.rows.length - 1) * this.rowGap

        // --- Measure layouts (reusing those whose inputs are unchanged) ---
        plans.forEach((plan, i) => {
            const row = this._rowByMeasure.get(plan.measure)
            /* v8 ignore next -- defensive: packing assigns every measure to a row */
            if (!row) return
            const context = {
                x: row.getMeasureX(plan.measure),
                width: row.getMeasureWidth(plan.measure),
                rowIndex: row.index,
                showsClef: flags[i].showsClef,
                showsKeySignature: flags[i].showsKeySignature,
                showsTimeSignature: flags[i].showsTimeSignature,
                accidentals: plan.accidentals,
                noteWidths: plan.noteWidths,
                keyWidths: plan.keyWidths,
                reuseSignature: [
                    plan.measure.version,
                    row.getMeasureX(plan.measure),
                    row.getMeasureWidth(plan.measure),
                    row.index,
                    flags[i].showsClef,
                    flags[i].showsKeySignature,
                    flags[i].showsTimeSignature,
                    plan.leadingKeyDrawnSignature,
                ].join('|'),
            }
            const previousLayout = previous?._measureLayouts.get(plan.measure)
            const layout =
                previousLayout?.reuseSignature === context.reuseSignature ? previousLayout : new MeasureLayout(plan.measure, context)
            this._measureLayouts.set(plan.measure, layout)
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
                    previousTie?.contextSignature === TieLayout.signatureFor(context)
                        ? previousTie
                        : new TieLayout(note, nextNote, context)
                this._tiesByKey.set(key, tie)
                this.ties.push(tie)
            }
        }
    }

    private tieContextFor(note: Note, nextNote: Note): TieLayoutContext {
        const startMeasure = note.measure
        const endMeasure = nextNote.measure
        const startRow = this.rowFor(startMeasure)
        const endRow = this.rowFor(endMeasure)
        const startLayout = this.measureLayoutFor(startMeasure)
        const endLayout = this.measureLayoutFor(endMeasure)
        const startNoteLayout = startLayout.noteLayoutFor(note)
        const endNoteLayout = endLayout.noteLayoutFor(nextNote)
        const stemDir = startLayout.beamFor(note)?.stemDir ?? note.stemDir
        return {
            direction: stemDir === 'up' ? 1 : -1,
            startRowIndex: startRow.index,
            endRowIndex: endRow.index,
            startRowWidth: startRow.width,
            startX:
                startRow.getMeasureX(startMeasure) +
                startLayout.getXForElement(note) +
                startNoteLayout.noteX +
                startNoteLayout.width.noteHeadWidth,
            startY: startNoteLayout.noteY,
            endX: endRow.getMeasureX(endMeasure) + endLayout.getXForElement(nextNote) + endNoteLayout.noteX,
            endY: endNoteLayout.noteY,
        }
    }

    private static buildPlans(score: Score): MeasurePlan[] {
        let previousClefType: string | undefined
        let previousKeyFifths: number | undefined
        let previousTimeSignature: { beatAmount: number; beatType: number } | undefined
        return score.measures.map((measure) => {
            const accidentals = new DisplayedAccidentals(measure).byNote
            const notePairs = measure.notes.map((note) => [note, new NoteWidth(note, accidentals.get(note))] as [Note, NoteWidth])
            const leadingKeyWidth = new KeySignatureWidth(measure.keySignature.drawnAccidentals)
            const midKeyPairs = measure.midMeasureKeySignatures.map(
                (key) => [key, new KeySignatureWidth(key.drawnAccidentals)] as [KeySignature, KeySignatureWidth],
            )
            const noteWidths = new Map(notePairs)
            const keyWidths = new Map<KeySignature, KeySignatureWidth>([[measure.keySignature, leadingKeyWidth], ...midKeyPairs])
            const fixedWidth =
                sumBy(measure.midMeasureClefs, (clef) => clef.width.total) +
                sumBy(midKeyPairs, ([, width]) => width.total) +
                sumBy(notePairs, ([, width]) => width.total) +
                MeasureLayout.barlineWidth(measure.endBarline)
            const base: MeasureFlags = {
                showsClef: previousClefType === undefined || previousClefType !== measure.clef.type,
                showsKeySignature: previousKeyFifths === undefined || previousKeyFifths !== measure.keySignature.fifths,
                showsTimeSignature:
                    !previousTimeSignature ||
                    previousTimeSignature.beatAmount !== measure.timeSignature.beatAmount ||
                    previousTimeSignature.beatType !== measure.timeSignature.beatType,
            }
            previousClefType = measure.lastClef.type
            previousKeyFifths = measure.lastKey.fifths
            previousTimeSignature = measure.timeSignature
            return {
                measure,
                accidentals,
                noteWidths,
                keyWidths,
                leadingKeyWidth,
                fixedWidth,
                base,
                leadingKeyDrawnSignature: measure.keySignature.drawnAccidentals.map((a) => `${a.glyphName}${a.name}${a.octave}`).join(','),
            }
        })
    }

    private static minimalWidth(plan: MeasurePlan, flags: MeasureFlags, minimumMeasureWidth: number): number {
        const sum =
            (flags.showsClef ? plan.measure.clef.width.total : 0) +
            (flags.showsKeySignature ? plan.leadingKeyWidth.total : 0) +
            (flags.showsTimeSignature ? plan.measure.timeSignature.width.total : 0) +
            plan.fixedWidth
        return Math.max(sum, minimumMeasureWidth)
    }

    /** Greedy row fill, reserving measure-button space on every row while fitting (the historical budget). */
    private static packGreedy(widths: number[], scoreWidth: number): number[][] {
        const budget = availableRowWidth({ isLastRow: true, scoreWidth })
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

    getRowForY(y: number): RowLayout | undefined {
        return this.rows[Math.floor(y / (this.rowHeight + this.rowGap))]
    }
}
