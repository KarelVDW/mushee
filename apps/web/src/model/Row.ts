import { sumBy } from 'lodash-es'

import { MAX_MEASURES_PER_ROW } from '@/components/notation/constants'

import { RowLayout } from './layout/RowLayout'
import { availableRowWidth } from './layout/rowWidth'
import type { Measure } from './Measure'
import { Score } from './Score'

export class Row {
    private _layout: RowLayout | null = null
    private _measures: Measure[] = []

    constructor(
        readonly score: Score,
        readonly index: number,
    ) {}

    get measures(): Measure[] {
        return this._measures
    }

    get width(): number {
        return sumBy(this._measures, (m) => m.minimalWidth)
    }

    get firstMeasures(): Measure {
        return this._measures[0]
    }

    get lastMeasures(): Measure {
        return this._measures[this._measures.length - 1]
    }

    canFit(measure: Measure): boolean {
        return this._measures.length < MAX_MEASURES_PER_ROW && this.width + measure.minimalWidth <= availableRowWidth({ isLastRow: true })
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

    get layout(): RowLayout {
        this._layout ||= new RowLayout(this)
        return this._layout
    }

    invalidateLayout() {
        this._layout = null
        this.measures.forEach((m) => m.invalidateLayout())
    }
}
