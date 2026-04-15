import { getGlyphWidth, getYForLine } from '@/components/notation'

import type { TimeSignature } from '../TimeSignature'

export class TimeSignatureLayout {
    readonly id = crypto.randomUUID()
    readonly x: number
    readonly topDigits: { glyphName: string; x: number; y: number }[]
    readonly bottomDigits: { glyphName: string; x: number; y: number }[]

    constructor(timeSignature: TimeSignature) {
        this.x = timeSignature.width.paddingLeft
        const topY = getYForLine(1)
        this.topDigits = timeSignature.beatsDigits.map((digit, i) => ({
            glyphName: `timeSig${digit}`,
            x: this.x + i * getGlyphWidth(`timeSig${digit}`),
            y: topY,
        }))
        const bottomY = getYForLine(3)
        this.bottomDigits = timeSignature.beatTypeDigits.map((digit, i) => ({
            glyphName: `timeSig${digit}`,
            x: this.x + i * getGlyphWidth(`timeSig${digit}`),
            y: bottomY,
        }))
    }
}
