import { sumBy } from 'lodash-es'

import { MAX_MEASURES_PER_ROW, SCORE_WIDTH } from '@/components/notation/constants'

import { RowLayout } from './layout/RowLayout'
import type { Measure } from './Measure'
import { Score } from './Score'

const MEASURE_ABSOLUTE_MIN_WIDTH = SCORE_WIDTH / (MAX_MEASURES_PER_ROW + 1)

export class Row {
    private _layout: RowLayout | null = null
    private _measures: Measure[] = []

    constructor(readonly score: Score, readonly index: number) {}

    get measures(): Measure[] {
        return this._measures
    }

    get width(): number {
        return sumBy(this._measures, (m) => this.effectiveWidth(m))
    }

    get firstMeasures(): Measure {
        return this._measures[0]
    }

    get lastMeasures(): Measure {
        return this._measures[this._measures.length - 1]
    }

    canFit(measure: Measure): boolean {
        return this._measures.length < MAX_MEASURES_PER_ROW && (this.width + this.effectiveWidth(measure)) <= SCORE_WIDTH
    }

    addMeasure(measure: Measure) {
        this._measures.push(measure)
        this.invalidateLayout()
    }

    removeLastMeasure(): Measure | undefined {
        const measure = this._measures.pop()
        if (measure) {
            this.invalidateLayout()
        }
        return measure
    }

    get isEmpty(): boolean {
        return this._measures.length === 0
    }

    private effectiveWidth(measure: Measure): number {
        return Math.max(measure.minimalWidth, MEASURE_ABSOLUTE_MIN_WIDTH)
    }

    get layout(): RowLayout {
        this._layout ||= new RowLayout(this)
        return this._layout
    }

    invalidateLayout() {
        this._layout = null
        this.measures.forEach(m => m.invalidateLayout())
    }
}
