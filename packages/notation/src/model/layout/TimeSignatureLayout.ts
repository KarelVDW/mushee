import { Bravura } from '../../engraving/Bravura'
import type { TimeSignature } from '../TimeSignature'
import { Staff } from './Staff'
import type { LayoutGlyph } from './types'

export class TimeSignatureLayout {
    readonly id = crypto.randomUUID()
    readonly x: number
    readonly topDigits: LayoutGlyph[]
    readonly bottomDigits: LayoutGlyph[]

    constructor(timeSignature: TimeSignature) {
        this.x = timeSignature.width.paddingLeft
        const topY = Staff.yForStaffLine(1)
        this.topDigits = timeSignature.beatsDigits.map((digit, i) => ({
            glyphName: `timeSig${digit}`,
            x: this.x + i * Bravura.width(`timeSig${digit}`),
            y: topY,
        }))
        const bottomY = Staff.yForStaffLine(3)
        this.bottomDigits = timeSignature.beatTypeDigits.map((digit, i) => ({
            glyphName: `timeSig${digit}`,
            x: this.x + i * Bravura.width(`timeSig${digit}`),
            y: bottomY,
        }))
    }
}
