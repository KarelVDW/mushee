import { MAX_MEASURES_PER_ROW, NUM_STAFF_LINES, SPACE_ABOVE_STAFF, STAVE_LINE_DISTANCE } from '@/components/notation/constants'
import type { LayoutBarline, LayoutLine } from '@/components/notation/types'

import type { Measure } from '../Measure'
import { Resizer, type Sizeable } from '../util/Resizer'
import { availableRowWidth } from './rowWidth'

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
    readonly openingBarline: LayoutBarline
    private readonly _minimalWidths: Map<Measure, number>
    private readonly _scoreWidth: number
    private readonly _measureData = new Map<Measure, { width: number; measureX: number }>()

    constructor(context: RowLayoutContext) {
        this.index = context.index
        this.isLastRow = context.isLastRow
        this.measures = context.measures
        this._minimalWidths = context.minimalWidths
        this._scoreWidth = context.scoreWidth

        const totalWidth = availableRowWidth({ isLastRow: context.isLastRow, scoreWidth: context.scoreWidth })
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

        const headroom = SPACE_ABOVE_STAFF * STAVE_LINE_DISTANCE
        this.staffLines = Array.from({ length: NUM_STAFF_LINES }, (_, i) => {
            const y = headroom + i * STAVE_LINE_DISTANCE
            return { x1: 0, y1: y, x2: this.width, y2: y }
        })
        this.openingBarline = { x: 0, y: headroom, height: (NUM_STAFF_LINES - 1) * STAVE_LINE_DISTANCE, type: 'single' }
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
