import { sumBy } from 'lodash-es'

import { MAX_MEASURES_PER_ROW, ROW_GAP, ROW_HEIGHT, SCORE_WIDTH } from '@/components/notation/constants'

import type { Measure } from '../Measure'
import type { Score } from '../Score'
import { RowLayout } from './RowLayout'
export class ScoreLayout {
    readonly id = crypto.randomUUID()
    readonly scoreWidth: number
    readonly rowGap: number
    readonly rowHeight: number
    readonly maxMeasuresPerRow: number
    private _rows?: RowLayout[]
    private _measureData?: Map<Measure, { width: number; measureX: number; rowIndex: number; indexInRow: number }>

    constructor(private score: Score) {
        this.scoreWidth = SCORE_WIDTH
        this.rowGap = ROW_GAP
        this.rowHeight = ROW_HEIGHT
        this.maxMeasuresPerRow = MAX_MEASURES_PER_ROW
    }

    private formRows() {
        if (this._rows) return
        let measureData: Map<Measure, { width: number; measureX: number; rowIndex: number; indexInRow: number }> = new Map()
        const rows: RowLayout[] = []
        const measures = [...this.score.measures]
        let currentRow: Measure[] = []
        let currentRowWidth = 0
        const measureAbsoluteMinWidth = SCORE_WIDTH / (MAX_MEASURES_PER_ROW + 1)
        let rowIndex = 0
        while (measures.length) {
            // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
            const measure = measures.shift()!
            const measureMinWidth = measure.minimalWidth > measureAbsoluteMinWidth ? measure.minimalWidth : measureAbsoluteMinWidth
            if (measureMinWidth + currentRowWidth > SCORE_WIDTH && currentRow.length > 0) {
                measureData = new Map([...measureData.entries(), ...(this.processRowMeasures(currentRow, rowIndex)?.entries() || [])])
                rows.push(new RowLayout(currentRow, sumBy(currentRow, (m) => measureData.get(m)?.width ?? 0)))
                rowIndex++
                currentRow = []
                currentRowWidth = 0
            }
            currentRow.push(measure)
            currentRowWidth += measureMinWidth
        }
        measureData = new Map([...measureData.entries(), ...(this.processRowMeasures(currentRow, rowIndex)?.entries() || [])])
        rows.push(new RowLayout(currentRow, sumBy(currentRow, (m) => measureData.get(m)?.width ?? 0)))

        this._measureData = measureData
        this._rows = rows
    }

    private processRowMeasures(measures: Measure[], rowIndex: number) {
        const measureData: Map<Measure, { width: number; measureX: number; rowIndex: number; indexInRow: number }> = new Map()
        if (!measures.length) return
        const totalWidth = SCORE_WIDTH
        const defaultMeasureWidth = totalWidth / measures.length
        const specialDemandMeasures = new Set(measures.filter((m) => m.minimalWidth > defaultMeasureWidth))

        const specialWidth = Array.from(specialDemandMeasures).reduce((sum, m) => sum + m.minimalWidth, 0)
        const normalCount = measures.length - specialDemandMeasures.size
        const normalWidth = normalCount > 0 ? (totalWidth - specialWidth) / normalCount : 0
        let cursorX = 0
        for (let i = 0; i < measures.length; i++) {
            const m = measures[i]
            const width = specialDemandMeasures.has(m) ? m.minimalWidth : normalWidth
            measureData.set(m, { width, measureX: cursorX, rowIndex, indexInRow: i })
            cursorX += width
        }
        return measureData
    }
    // ── Public accessors (used by MeasureLayout) ──────────────────────

    getMeasureX(measure: Measure): number {
        this.formRows()
        const data = this._measureData?.get(measure)
        if (!data) throw new Error('Measure not yet measured')
        return data.measureX
    }

    getRowIndex(measure: Measure): number {
        this.formRows()
        const data = this._measureData?.get(measure)
        if (!data) throw new Error('Measure not yet measured')
        return data?.rowIndex ?? 0
    }

    getMeasureWidth(measure: Measure): number {
        this.formRows()
        const data = this._measureData?.get(measure)
        if (!data) throw new Error('Measure not yet measured')
        return data?.width ?? 0
    }

    getRowIndexForY(y: number) {
        return  Math.floor(y / (this.rowHeight + this.rowGap))
    }

    getMeasureForX(x: number, rowIndex: number): Measure | null {
        this.formRows()
        const measures = this._rows?.[rowIndex]?.measures
        if (!measures) return null
        for (const measure of measures) {
            const data = this._measureData?.get(measure)
            if (!data) continue
            if (x >= data.measureX && x < data.measureX + data.width)return measure
        }
        return null
    }

    // ── Row structure ─────────────────────────────────────────────────

    get rows(): RowLayout[] {
        this.formRows()
        return this._rows ?? []
    }

    get totalHeight() {
        const rowCount = Math.ceil(this.score.measures.length / (this.maxMeasuresPerRow ?? 4))
        return rowCount * this.rowHeight + Math.max(0, rowCount - 1) * this.rowGap
    }
}
