import { sumBy } from 'lodash-es'

import { MAX_MEASURES_PER_ROW, NUM_STAFF_LINES, SPACE_ABOVE_STAFF, STAVE_LINE_DISTANCE } from '@/components/notation/constants'
import type { LayoutBarline, LayoutLine } from '@/components/notation/types'

import type { Measure } from '../Measure'
import type { Row } from '../Row'
import { Resizer, type Sizeable } from '../util/Resizer'
import { availableRowWidth } from './rowWidth'

export class RowLayout {
    readonly id = crypto.randomUUID()
    private _measureData?: Map<Measure, { width: number; measureX: number; indexInRow: number }>

    constructor(readonly row: Row) {}

    private get measureData() {
        if (!this._measureData) {
            const measureData = new Map<Measure, { width: number; measureX: number; indexInRow: number }>()
            const measures = this.row.measures
            if (!measures.length) {
                this._measureData = measureData
                return measureData
            }
            const totalWidth = availableRowWidth({ isLastRow: this.row.score.lastRow === this.row })
            const allowIncompleteRow = this.row.score.lastRow === this.row && measures.length <= 2
            const defaultMeasureWidth = totalWidth / (allowIncompleteRow ? MAX_MEASURES_PER_ROW : measures.length)
            const sizeableElements: Array<Sizeable & { measure: Measure }> = measures.map((measure) => ({
                measure,
                minimum: measure.minimalWidth,
                default: defaultMeasureWidth,
            }))
            const resizer = new Resizer(sizeableElements, allowIncompleteRow ? { maximumWidth: totalWidth } : { width: totalWidth })
            let cursorX = 0
            for (let i = 0; i < sizeableElements.length; i++) {
                const el = sizeableElements[i]
                const width = resizer.getSize(el)
                measureData.set(el.measure, { width, measureX: cursorX, indexInRow: i })
                cursorX += width
            }
            this._measureData = measureData
        }
        return this._measureData
    }

    get width(): number {
        /* v8 ignore next -- defensive: measureData is keyed by exactly this.row.measures, so the lookup and ?? 0 fallback always hit */
        return sumBy(this.row.measures, (m) => this.measureData.get(m)?.width ?? 0)
    }

    getMeasureX(measure: Measure): number {
        const data = this.measureData.get(measure)
        if (!data) throw new Error('Measure not in this row')
        return data.measureX
    }

    getMeasureWidth(measure: Measure): number {
        const data = this.measureData.get(measure)
        if (!data) throw new Error('Measure not in this row')
        return data.width
    }

    getMeasureForX(x: number): Measure | null {
        for (const measure of this.row.measures) {
            const data = this.measureData.get(measure)
            /* v8 ignore next -- defensive: measureData is keyed by exactly this.row.measures, so data is always present */
            if (!data) continue
            if (x >= data.measureX && x < data.measureX + data.width) return measure
        }
        return null
    }

    get staffLines(): LayoutLine[] {
        const headroom = SPACE_ABOVE_STAFF * STAVE_LINE_DISTANCE
        const lines: LayoutLine[] = []
        for (let i = 0; i < NUM_STAFF_LINES; i++) {
            const y = headroom + i * STAVE_LINE_DISTANCE
            lines.push({ x1: 0, y1: y, x2: this.width, y2: y })
        }
        return lines
    }

    get openingBarline(): LayoutBarline {
        const headroom = SPACE_ABOVE_STAFF * STAVE_LINE_DISTANCE
        const staffHeight = (NUM_STAFF_LINES - 1) * STAVE_LINE_DISTANCE
        return { x: 0, y: headroom, height: staffHeight, type: 'single' }
    }
}
