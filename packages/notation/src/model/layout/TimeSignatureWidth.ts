import type { TimeSignature } from '../TimeSignature'
import { DigitRun } from './DigitRun'
import type { PhysicalWidth } from './PhysicalWidth'

export class TimeSignatureWidth implements PhysicalWidth {
    readonly paddingLeft: number = 4
    readonly paddingRight: number = 15
    /** The wider of the two digit rows — the narrower one is centred under or over it. */
    readonly content: number
    readonly total: number

    constructor(timeSignature: TimeSignature) {
        this.content = Math.max(new DigitRun(timeSignature.beatAmount).width, new DigitRun(timeSignature.beatType).width)
        this.total = this.paddingLeft + this.content + this.paddingRight
    }
}
