import type { ClefType } from '@/components/notation/types'

import { ClefLayout } from './layout/ClefLayout'
import { Measure } from './Measure'

export class Clef {
    private _measure: Measure | undefined
    private _layout: ClefLayout | null = null

    constructor(readonly type: ClefType) {}

    get layout() {
        if (!this._layout) this._layout = new ClefLayout(this)
        return this._layout
    }

    get measure() {
        if (!this._measure) throw new Error('Note is not assigned to measure')
        return this._measure
    }

    setMeasure(measure: Measure | undefined) {
        this._measure = measure
    }
}
