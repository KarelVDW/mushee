import { MAX_MEASURES_PER_ROW, MEASURE_BUTTON_SPACING, NUM_STAFF_LINES } from '../../engraving/constants'
import type { Measure } from '../Measure'
import { BarlineLayout } from './BarlineLayout'
import { Resizer, type Sizeable } from './Resizer'
import { Staff } from './Staff'
import type { LayoutLine } from './types'

export interface RowLayoutContext {
    index: number
    isLastRow: boolean
    measures: Measure[]
    /** Minimal width per measure, computed by the packing pass. */
    minimalWidths: Map<Measure, number>
    /** Total layout width the row's budget derives from (responsive reflow input). */
    scoreWidth: number
}

/**
 * One staff line of the score: the measures packed onto it and their resolved
 * x/width. A trailing, not-yet-full last row keeps measures at their natural
 * width instead of stretching them across the page.
 */
export class RowLayout {
    readonly id = crypto.randomUUID()
    readonly index: number
    readonly isLastRow: boolean
    readonly measures: Measure[]
    readonly width: number
    readonly staffLines: LayoutLine[]
    readonly openingBarline: BarlineLayout
    private readonly _minimalWidths: Map<Measure, number>
    private readonly _scoreWidth: number
    private readonly _measureData = new Map<Measure, { width: number; measureX: number }>()

    constructor(context: RowLayoutContext) {
        this.index = context.index
        this.isLastRow = context.isLastRow
        this.measures = context.measures
        this._minimalWidths = context.minimalWidths
        this._scoreWidth = context.scoreWidth

        const totalWidth = RowLayout.availableWidth(context.scoreWidth, context.isLastRow)
        const allowIncompleteRow = context.isLastRow && context.measures.length <= 2
        const defaultMeasureWidth = totalWidth / (allowIncompleteRow ? MAX_MEASURES_PER_ROW : context.measures.length)
        const sizeables: Array<Sizeable & { measure: Measure }> = context.measures.map((measure) => ({
            measure,
            minimum: context.minimalWidths.get(measure) ?? 0,
            default: defaultMeasureWidth,
        }))
        const resizer = new Resizer(sizeables, allowIncompleteRow ? { maximumWidth: totalWidth } : { width: totalWidth })
        let cursorX = 0
        for (const el of sizeables) {
            const width = resizer.getSize(el)
            this._measureData.set(el.measure, { width, measureX: cursorX })
            cursorX += width
        }
        this.width = cursorX

        this.staffLines = Array.from({ length: NUM_STAFF_LINES }, (_, i) => {
            const y = Staff.yForStaffLine(i)
            return { x1: 0, y1: y, x2: this.width, y2: y }
        })
        this.openingBarline = new BarlineLayout('single', 0)
    }

    /**
     * Horizontal budget available to a row's measures within a score laid out
     * `scoreWidth` units wide. The last row reserves MEASURE_BUTTON_SPACING for the
     * add/remove-measure buttons after the final barline (ScoreLayout.measureButtons), so
     * packing and RowLayout must agree on this number to keep row composition consistent
     * with layout. See ScoreLayout.packGreedy.
     */
    static availableWidth(scoreWidth: number, isLastRow: boolean): number {
        return scoreWidth - (isLastRow ? MEASURE_BUTTON_SPACING : 0)
    }

    /** Whether this row's inputs are identical — used by ScoreLayout to reuse the instance across rebuilds. */
    matches(context: RowLayoutContext): boolean {
        if (this.index !== context.index || this.isLastRow !== context.isLastRow) return false
        if (this._scoreWidth !== context.scoreWidth) return false
        if (this.measures.length !== context.measures.length) return false
        return this.measures.every(
            (measure, i) => context.measures[i] === measure && context.minimalWidths.get(measure) === this._minimalWidths.get(measure),
        )
    }

    getMeasureX(measure: Measure): number {
        const data = this._measureData.get(measure)
        if (!data) throw new Error('Measure not in this row')
        return data.measureX
    }

    getMeasureWidth(measure: Measure): number {
        const data = this._measureData.get(measure)
        if (!data) throw new Error('Measure not in this row')
        return data.width
    }

    getMeasureForX(x: number): Measure | null {
        for (const measure of this.measures) {
            const data = this._measureData.get(measure)
            /* v8 ignore next -- defensive: every row measure is spaced at construction */
            if (!data) continue
            if (x >= data.measureX && x < data.measureX + data.width) return measure
        }
        return null
    }
}
