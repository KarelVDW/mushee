import { TimeSignatureLayout } from './layout/TimeSignatureLayout'
import type { Measure } from './Measure'

export class TimeSignature {
    readonly beats: number
    readonly beatType: number
    private _measure: Measure | undefined
    private _layout: TimeSignatureLayout | null = null

    constructor(beats: number, beatType: number) {
        this.beats = beats
        this.beatType = beatType
    }

    get layout() {
        if (!this._layout) this._layout = new TimeSignatureLayout(this)
        return this._layout
    }

    get measure() {
        if (!this._measure) throw new Error('TimeSignature is not assigned to a measure')
        return this._measure
    }

    setMeasure(measure: Measure | undefined) {
        this._measure = measure
    }

    invalidateLayout() {
        this._layout = null
    }

    /** Total beats per measure in quarter-note units */
    get maxBeats(): number {
        return this.beats * (4 / this.beatType)
    }

    /** String digits of the numerator, e.g. [4] or [1, 2] for 12/8 */
    get beatsDigits(): string[] {
        return String(this.beats).split('')
    }

    /** String digits of the denominator */
    get beatTypeDigits(): string[] {
        return String(this.beatType).split('')
    }
}
