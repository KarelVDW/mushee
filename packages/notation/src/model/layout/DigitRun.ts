import { sum } from 'lodash-es'

import { Bravura } from '../../engraving/Bravura'
import { GLYPH_SCALE } from '../../engraving/GlyphScale'
import type { LayoutGlyph } from './types'

/**
 * An engraved number — a time signature's numerator or denominator, a tuplet's
 * ratio — as a run of Bravura `timeSig` digit glyphs set side by side. Each
 * digit is measured once; the run's width and its glyph positions both come
 * from those measurements, so multi-digit numbers (12/8, a 10-tuplet) space
 * by their real digit widths.
 */
export class DigitRun {
    readonly glyphNames: string[]
    readonly width: number
    private readonly _digitWidths: number[]

    constructor(
        value: number,
        private readonly scale: number = GLYPH_SCALE,
    ) {
        this.glyphNames = String(value)
            .split('')
            .map((digit) => `timeSig${digit}`)
        this._digitWidths = this.glyphNames.map((name) => Bravura.width(name, scale))
        this.width = sum(this._digitWidths)
    }

    /** The run's glyphs, horizontally centred on `cx`, each at the run's scale with its origin on `y`. */
    centredAt(cx: number, y: number): LayoutGlyph[] {
        let x = cx - this.width / 2
        return this.glyphNames.map((glyphName, i) => {
            const glyph = { glyphName, x, y, scale: this.scale }
            x += this._digitWidths[i]
            return glyph
        })
    }
}
