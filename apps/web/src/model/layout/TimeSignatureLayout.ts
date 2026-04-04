import { getGlyphWidth, getYForLine } from '@/components/notation'

import type { TimeSignature } from '../TimeSignature'

export class TimeSignatureLayout {
    readonly width: number

    private _topDigits: { glyphName: string; x: number; y: number }[] | null = null
    private _bottomDigits: { glyphName: string; x: number; y: number }[] | null = null

    constructor(private timeSignature: TimeSignature) {
        this.width = Math.max(
            timeSignature.beatsDigits.reduce((s, d) => s + getGlyphWidth(`timeSig${d}`), 0),
            timeSignature.beatTypeDigits.reduce((s, d) => s + getGlyphWidth(`timeSig${d}`), 0),
        )
    }

    get topDigits() {
        if (!this._topDigits) {
            const x = this.timeSignature.measure.layout.timeSignatureX
            const topY = getYForLine(1)
            this._topDigits = this.timeSignature.beatsDigits.map((digit, i) => ({
                glyphName: `timeSig${digit}`,
                x: x + i * getGlyphWidth(`timeSig${digit}`),
                y: topY,
            }))
        }
        return this._topDigits
    }

    get bottomDigits() {
        if (!this._bottomDigits) {
            const x = this.timeSignature.measure.layout.timeSignatureX
            const bottomY = getYForLine(3)
            this._bottomDigits = this.timeSignature.beatTypeDigits.map((digit, i) => ({
                glyphName: `timeSig${digit}`,
                x: x + i * getGlyphWidth(`timeSig${digit}`),
                y: bottomY,
            }))
        }
        return this._bottomDigits
    }
}
