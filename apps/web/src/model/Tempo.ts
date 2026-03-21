import { TempoLayout } from './layout/TempoLayout'
import type { Measure } from './Measure'

export class Tempo {
    private _layout: TempoLayout | undefined

    constructor(
        readonly measure: Measure,
        readonly beatPosition: number,
        readonly bpm: number,
    ) {}

    get layout() {
        this._layout ||= new TempoLayout(this)
        return this._layout
    }
}
