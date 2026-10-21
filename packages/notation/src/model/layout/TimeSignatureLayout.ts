import type { TimeSignature } from '../TimeSignature'
import { DigitRun } from './DigitRun'
import { Staff } from './Staff'
import type { LayoutGlyph } from './types'

/** The stacked meter digits: both rows centred on the content box, numerator on staff line 1, denominator on line 3. */
export class TimeSignatureLayout {
    readonly id = crypto.randomUUID()
    readonly topDigits: LayoutGlyph[]
    readonly bottomDigits: LayoutGlyph[]

    constructor(timeSignature: TimeSignature) {
        const width = timeSignature.width
        const centreX = width.paddingLeft + width.content / 2
        this.topDigits = new DigitRun(timeSignature.beatAmount).centredAt(centreX, Staff.yForStaffLine(1))
        this.bottomDigits = new DigitRun(timeSignature.beatType).centredAt(centreX, Staff.yForStaffLine(3))
    }
}
