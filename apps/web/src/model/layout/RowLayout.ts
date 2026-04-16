import { sumBy } from 'lodash-es'

import { MAX_MEASURES_PER_ROW, NUM_STAFF_LINES, SCORE_WIDTH, SPACE_ABOVE_STAFF, STAVE_LINE_DISTANCE } from '@/components/notation/constants'
import type { LayoutBarline, LayoutLine } from '@/components/notation/types'

import type { Measure } from '../Measure'
import type { Row } from '../Row'

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
            const totalWidth = SCORE_WIDTH - (this.row.score.lastRow === this.row ? 30 : 0)

            // Iteratively allocate special measures (those exceeding equal share) until stable
            const widths = new Map<Measure, number>()
            let remaining = totalWidth
            let unallocated = [...measures]
            let changed = true
            while (changed) {
                changed = false
                const share = remaining / unallocated.length
                for (const m of [...unallocated]) {
                    if (m.minimalWidth > share) {
                        widths.set(m, m.minimalWidth)
                        remaining -= m.minimalWidth
                        unallocated = unallocated.filter((x) => x !== m)
                        changed = true
                    }
                }
            }
            let normalWidth = unallocated.length > 0 ? remaining / unallocated.length : 0
            if (measures.length <= 2) normalWidth = Math.min(normalWidth, totalWidth / MAX_MEASURES_PER_ROW)
            for (const m of unallocated) widths.set(m, normalWidth)

            let cursorX = 0
            for (let i = 0; i < measures.length; i++) {
                const m = measures[i]
                const width = widths.get(m) ?? 0
                measureData.set(m, { width, measureX: cursorX, indexInRow: i })
                cursorX += width
            }
            this._measureData = measureData
        }
        return this._measureData
    }

    get width(): number {
        return sumBy(this.row.measures, m => this.measureData.get(m)?.width ?? 0 )
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
