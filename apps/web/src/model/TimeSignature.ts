import { TimeSignatureLayout } from './layout/TimeSignatureLayout'
import type { Measure } from './Measure'
import { TimeSignatureWidth } from './width/TimeSignatureWidth'

export class TimeSignature {
    readonly beatAmount: number
    readonly beatType: number
    private _measure: Measure | undefined
    private _layout: TimeSignatureLayout | null = null
    private _width: TimeSignatureWidth | null = null

    constructor(beatAmount: number, beatType: number) {
        this.beatAmount = beatAmount
        this.beatType = beatType
    }

    get width() {
        if (!this._width) this._width = new TimeSignatureWidth(this)
        return this._width
    }

    get layout() {
        if (!this._layout) this._layout = new TimeSignatureLayout(this)
        return this._layout
    }

    invalidateLayout() {
        this._layout = null
    }

    get measure() {
        if (!this._measure) throw new Error('TimeSignature is not assigned to a measure')
        return this._measure
    }

    setMeasure(measure: Measure | undefined) {
        this._measure = measure
    }

    /** Total beats per measure in quarter-note units */
    get maxBeats(): number {
        return this.beatAmount * (4 / this.beatType)
    }

    /** String digits of the numerator, e.g. [4] or [1, 2] for 12/8 */
    get beatsDigits(): string[] {
        return String(this.beatAmount).split('')
    }

    /** String digits of the denominator */
    get beatTypeDigits(): string[] {
        return String(this.beatType).split('')
    }
}
