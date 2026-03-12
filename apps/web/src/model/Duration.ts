import type { DurationType } from '@/components/notation/types'

/** Ordered list of duration values for greedy decomposition (largest first) */
const DURATION_VALUES: Array<{ duration: DurationType; dots?: number; beats: number }> = [
    { duration: 'w', beats: 4 },
    { duration: 'h', dots: 1, beats: 3 },
    { duration: 'h', beats: 2 },
    { duration: 'q', dots: 1, beats: 1.5 },
    { duration: 'q', beats: 1 },
    { duration: '8', dots: 1, beats: 0.75 },
    { duration: '8', beats: 0.5 },
    { duration: '16', beats: 0.25 },
]

export class Duration {
    readonly type: DurationType
    readonly dots: number
    readonly ratio: { numerator: number; denominator: number } // used for tuplets

    constructor(value?: { type?: DurationType; dots?: number; ratio?: { numerator: number; denominator: number } }) {
        this.type = value?.type || 'q'
        this.dots = value?.dots || 0
        this.ratio = value?.ratio || { numerator: 1, denominator: 1 }
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
        return this.beats * (this.ratio.numerator / this.ratio.denominator)
    }

    get beamCount(): number {
        switch (this.type) {
            case '8':
                return 1
            case '16':
                return 2
            default:
                return 0
        }
    }

    get isBeamable(): boolean {
        return this.beamCount > 0
    }

    get restGlyph(): string {
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

    get noteheadGlyph(): string {
        switch (this.type) {
            case 'w':
                return 'noteheadWhole'
            case 'h':
                return 'noteheadHalf'
            default:
                return 'noteheadBlack'
        }
    }

    flagGlyph(stemDirection: 'up' | 'down'): string | undefined {
        switch (this.type) {
            case '8':
                return stemDirection === 'up' ? 'flag8thUp' : 'flag8thDown'
            case '16':
                return stemDirection === 'up' ? 'flag16thUp' : 'flag16thDown'
            default:
                return undefined
        }
    }

    static fromBeats(beats: number): Duration[] {
        const result: Duration[] = []
        let remaining = beats
        while (remaining > 0.001) {
            let matched = false
            for (const v of DURATION_VALUES) {
                if (v.beats <= remaining + 0.001) {
                    result.push(new Duration({ type: v.duration, dots: v.dots }))
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
