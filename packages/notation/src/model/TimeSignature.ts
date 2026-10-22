import { BEAT_EPSILON, Duration } from './Duration'
import { TimeSignatureLayout } from './layout/TimeSignatureLayout'

/**
 * An immutable value object (no measure reference, no identity): instances are
 * shared freely across measures, so its layout (with its width) — which depends
 * only on the digits — is cached forever.
 */
export class TimeSignature {
    readonly beatAmount: number
    readonly beatType: number
    private _layout: TimeSignatureLayout | null = null

    constructor(beatAmount: number, beatType: number) {
        this.beatAmount = beatAmount
        this.beatType = beatType
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

    /**
     * The meter in plain words, counted in the beat the metronome and the count-in click
     * ({@link pulse}): "4 beats", "2 swaying beats" (6/8), "2 long beats" (2/2), "3 quick
     * beats" (3/8) — the time-signature picker's captions. Deriving the words from the pulse
     * keeps them from ever contradicting what the user hears. User copy that may change.
     */
    get plainName(): string {
        const count = this.pulsesPerMeasure
        return [count, this.beatFeel, count === 1 ? 'beat' : 'beats'].filter(Boolean).join(' ')
    }

    /** {@link plainName} per bar, as the meter chip's hint and the import summary say it: "4 beats in a bar". */
    get plainNamePerBar(): string {
        return `${this.plainName} in a bar`
    }

    /** How each beat feels: swaying (compound), long (a half-note pulse), quick (an eighth), or plain (null). */
    private get beatFeel(): string | null {
        if (this.isCompound) return 'swaying'
        const beats = this.pulse.beats
        if (beats > 1) return 'long'
        if (beats < 1) return 'quick'
        return null
    }

    /**
     * The span (quarter-note units) beams are grouped within: the pulse — one
     * quarter in 4/4, a dotted quarter in 6/8, a half in 2/2. When the pulse is
     * the eighth itself (3/8, 5/8, 7/8) nothing could ever beam, so the whole
     * bar is the unit: 3/8 beams its three eighths together and the irregular
     * meters beam per bar, as we store no 2+2+3-style grouping.
     */
    get beamUnit(): number {
        return this.beatType >= 8 && !this.isCompound ? this.maxBeats : this.pulse.beats
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
        const nextBoundary = Math.ceil((filledBeats - BEAT_EPSILON) / unitBeats) * unitBeats
        const partial = Duration.fromBeats(nextBoundary - filledBeats)
        const fullUnits = Math.round((this.maxBeats - nextBoundary) / unitBeats)
        return [...partial, ...Array.from({ length: fullUnits }, () => this.beatUnit)]
    }
}
