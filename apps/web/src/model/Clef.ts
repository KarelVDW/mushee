import type { ClefType } from '@/components/notation/types'

import { ClefLayout } from './layout/ClefLayout'
import { Measure } from './Measure'
import { ClefWidth } from './width/ClefWidth'

export class Clef {
    private _measure: Measure | undefined
    private _layout: ClefLayout | null = null
    private _width: ClefWidth | null = null

    constructor(readonly type: ClefType) {}

    get width() {
        if (!this._width) this._width = new ClefWidth(this)
        return this._width
    }

    get layout() {
        if (!this._layout) this._layout = new ClefLayout(this)
        return this._layout
    }

    get measure() {
        if (!this._measure) throw new Error('Clef is not assigned to measure')
        return this._measure
    }

    setMeasure(measure: Measure | undefined) {
        this._measure = measure
    }

    invalidateLayout() {
        this._layout = null
    }
}
