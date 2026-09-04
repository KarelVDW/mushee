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

    /** The denominator's note value (quarter in 4/4, eighth in 6/8) — the unit rests are filled in. */
    get beatUnit(): Duration {
        return Duration.fromBeats(4 / this.beatType)[0]
    }

    /**
     * Compound meters group the denominator in threes (6/8, 9/8, 12/8, 6/16 …):
     * the felt beat is the dotted note spanning one group, not the denominator.
     * 3/8 is simple triple (three eighth beats), so a numerator of 3 doesn't count.
     */
    get isCompound(): boolean {
        return this.beatType >= 8 && this.beatAmount > 3 && this.beatAmount % 3 === 0
    }

    /**
     * The beat a listener taps and a metronome clicks: the denominator note in
     * simple meters (quarter in 4/4, half in 2/2, eighth in 3/8 and 7/8), the
     * dotted denominator in compound ones (dotted quarter in 6/8). This is what
     * tempo markings are written in — `♩. = 60` for 6/8 — while `bpm` values
     * inside the model stay in quarter-note units (see `pulseBpmOf`).
     */
    get pulse(): Duration {
        return this.isCompound ? Duration.fromBeats(3 * (4 / this.beatType))[0] : this.beatUnit
    }

    /** Felt beats per measure: 4 in 4/4, 2 in 6/8, 4 in 12/8, 7 in 7/8. */
    get pulsesPerMeasure(): number {
        return Math.round(this.maxBeats / this.pulse.beats)
    }

    /** A quarter-note bpm expressed in this meter's pulse (90 quarter-bpm in 6/8 → ♩. = 60). */
    pulseBpmOf(quarterBpm: number): number {
        return quarterBpm / this.pulse.beats
    }

    /** A tempo counted in this meter's pulse converted to the model's quarter-note bpm (♩. = 60 in 6/8 → 90). */
    quarterBpmOf(pulseBpm: number): number {
        return pulseBpm * this.pulse.beats
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
