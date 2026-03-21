export class TimeSignature {
    readonly beats: number
    readonly beatType: number

    constructor(beats: number, beatType: number) {
        this.beats = beats
        this.beatType = beatType
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
