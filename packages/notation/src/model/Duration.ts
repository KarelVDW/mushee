import type { GlyphName } from '../engraving/Bravura'
import type { DurationType, StemDirection } from './types'

/** Tolerance for beat-sum comparisons — tuplet beats (e.g. thirds) don't sum exactly in floating point. */
export const BEAT_EPSILON = 0.001

/**
 * A time modification as MusicXML writes it: `actualNotes` notes in the time of
 * `normalNotes` (3:2 for a triplet). Plain notation is 1:1.
 */
export type TupletRatio = { readonly actualNotes: number; readonly normalNotes: number }

export class Duration {
    /** Every plain value the model writes, coarsest first — so a scan picks the largest that fits. */
    static readonly WRITABLE: readonly Duration[] = [
        new Duration({ type: 'w' }),
        new Duration({ type: 'h', dots: 1 }),
        new Duration({ type: 'h' }),
        new Duration({ type: 'q', dots: 1 }),
        new Duration({ type: 'q' }),
        new Duration({ type: '8', dots: 1 }),
        new Duration({ type: '8' }),
        new Duration({ type: '16' }),
    ]

    /** The finest written value (a sixteenth) in quarter-note beats: the grid imported time snaps to. */
    static readonly GRID_BEATS = 0.25

    readonly type: DurationType
    readonly dots: number
    readonly ratio: TupletRatio

    constructor(value?: { type?: DurationType; dots?: number; ratio?: TupletRatio }) {
        this.type = value?.type || 'q'
        this.dots = value?.dots || 0
        this.ratio = value?.ratio || { actualNotes: 1, normalNotes: 1 }
    }

    get baseBeats(): number {
        switch (this.type) {
            case 'w':
                return 4
            case 'h':
                return 2
            case 'q':
                return 1
            case '8':
                return 0.5
            case '16':
                return 0.25
        }
    }

    get beats(): number {
        if (this.dots <= 0) return this.baseBeats
        return this.baseBeats * (2 - 1 / Math.pow(2, this.dots))
    }

    get effectiveBeats(): number {
        return this.beats * (this.ratio.normalNotes / this.ratio.actualNotes)
    }

    /** Whether this value is written under a tuplet ratio — anything but plain 1:1. */
    get isTuplet(): boolean {
        return this.ratio.actualNotes !== 1 || this.ratio.normalNotes !== 1
    }

    /** Whether `other` is written under the same tuplet ratio (all plain values share 1:1). */
    sameRatioAs(other: Duration): boolean {
        return this.ratio.actualNotes === other.ratio.actualNotes && this.ratio.normalNotes === other.ratio.normalNotes
    }

    /**
     * Whether a value of `type` can take a dot. The sixteenth is the model's finest value: a
     * dotted one would leave a thirty-second's worth of bar that no rest can fill, so the bar
     * would come out short for good.
     */
    static canDot(type: DurationType): boolean {
        return type !== '16'
    }

    /** Whether this value can take a dot — {@link Duration.canDot} for its type. */
    get canDot(): boolean {
        return Duration.canDot(this.type)
    }

    get isBeamable(): boolean {
        return this.type === '8' || this.type === '16'
    }

    get hasSecondaryBeam(): boolean {
        return this.type === '16'
    }

    get restGlyph(): GlyphName {
        switch (this.type) {
            case 'w':
                return 'restWhole'
            case 'h':
                return 'restHalf'
            case 'q':
                return 'restQuarter'
            case '8':
                return 'rest8th'
            case '16':
                return 'rest16th'
        }
    }

    get restLine() {
        switch (this.type) {
            case 'w':
                return 4
            default:
                return 3
        }
    }

    /** Plain-language name, as read aloud: "quarter", "dotted quarter", "eighth". */
    get name(): string {
        const base = { w: 'whole', h: 'half', q: 'quarter', '8': 'eighth', '16': '16th' }[this.type]
        return this.dots > 0 ? `dotted ${base}` : base
    }

    get noteheadGlyph(): GlyphName {
        switch (this.type) {
            case 'w':
                return 'noteheadWhole'
            case 'h':
                return 'noteheadHalf'
            default:
                return 'noteheadBlack'
        }
    }

    flagGlyph(stemDirection: StemDirection): GlyphName | undefined {
        switch (this.type) {
            case '8':
                return stemDirection === 'up' ? 'flag8thUp' : 'flag8thDown'
            case '16':
                return stemDirection === 'up' ? 'flag16thUp' : 'flag16thDown'
            default:
                return undefined
        }
    }

    /** The next-shorter note value, or null at the bottom of the supported range. */
    private get shorterType(): DurationType | null {
        switch (this.type) {
            case 'w':
                return 'h'
            case 'h':
                return 'q'
            case 'q':
                return '8'
            case '8':
                return '16'
            case '16':
                return null
        }
    }

    /**
     * This duration written as a triplet: three notes of the next-shorter value in a
     * 3:2 ratio, together spanning the same time (dots carry over, so a dotted quarter
     * becomes three dotted eighths). Null when no shorter value exists.
     */
    tripletDivision(): Duration[] | null {
        const type = this.shorterType
        if (!type) return null
        return [0, 1, 2].map(() => new Duration({ type, dots: this.dots, ratio: { actualNotes: 3, normalNotes: 2 } }))
    }

    /**
     * Greedily decompose a span of occupied time into durations. With a ratio the
     * span is tuplet space (e.g. ⅔ beat inside a 3:2 triplet — inexpressible in
     * plain values): the written equivalent is decomposed and the ratio re-attached.
     */
    static fromBeats(beats: number, ratio?: TupletRatio): Duration[] {
        const result: Duration[] = []
        let remaining = ratio ? beats * (ratio.actualNotes / ratio.normalNotes) : beats
        while (remaining > BEAT_EPSILON) {
            let matched = false
            for (const v of Duration.WRITABLE) {
                if (v.beats <= remaining + BEAT_EPSILON) {
                    result.push(new Duration({ type: v.type, dots: v.dots, ratio }))
                    remaining -= v.beats
                    matched = true
                    break
                }
            }
            if (!matched) break
        }
        return result
    }
}
