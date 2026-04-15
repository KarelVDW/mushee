import { getGlyphWidth } from '@/components/notation'

import type { TimeSignature } from '../TimeSignature'
import { PhysicalWidth } from './PhysicalWidth'

export class TimeSignatureWidth implements PhysicalWidth {
    readonly paddingLeft: number = 4
    readonly paddingRight: number = 15
    readonly content: number
    readonly total: number

    constructor(timeSignature: TimeSignature) {
        this.content = Math.max(
            timeSignature.beatsDigits.reduce((s, d) => s + getGlyphWidth(`timeSig${d}`), 0),
            timeSignature.beatTypeDigits.reduce((s, d) => s + getGlyphWidth(`timeSig${d}`), 0),
        )
        this.total = this.paddingLeft + this.content + this.paddingRight
    }
}
