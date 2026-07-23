import { Duration } from './Duration'
import { TimeSignatureLayout } from './layout/TimeSignatureLayout'
import { TimeSignatureWidth } from './width/TimeSignatureWidth'

/**
 * An immutable value object (no measure reference, no identity): instances are
 * shared freely across measures, so its layout and width — which depend only on
 * the digits — are cached forever.
 */
export class TimeSignature {
    readonly beatAmount: number
    readonly beatType: number
    private _layout: TimeSignatureLayout | null = null
    private _width: TimeSignatureWidth | null = null

    constructor(beatAmount: number, beatType: number) {
        this.beatAmount = beatAmount
        this.beatType = beatType
    }

    get width(): TimeSignatureWidth {
        this._width ||= new TimeSignatureWidth(this)
        return this._width
    }

    get layout(): TimeSignatureLayout {
        this._layout ||= new TimeSignatureLayout(this)
        return this._layout
    }

    equals(other: TimeSignature): boolean {
        return this.beatAmount === other.beatAmount && this.beatType === other.beatType
    }

    /** Total beats per measure in quarter-note units */
    get maxBeats(): number {
        return this.beatAmount * (4 / this.beatType)
    }

    get beatUnit(): Duration {
        return Duration.fromBeats(4 / this.beatType)[0]
    }

    fillRests(filledBeats: number): Duration[] {
        if (filledBeats >= this.maxBeats) return []
        const unitBeats = this.beatUnit.beats
        const nextBoundary = Math.ceil((filledBeats - 1e-6) / unitBeats) * unitBeats
        const partial = Duration.fromBeats(nextBoundary - filledBeats)
        const fullUnits = Math.round((this.maxBeats - nextBoundary) / unitBeats)
        return [...partial, ...Array.from({ length: fullUnits }, () => this.beatUnit)]
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
