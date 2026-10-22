import { sum } from 'lodash-es'

import { Bravura, type GlyphName } from '../../engraving/Bravura'
import { GLYPH_SCALE } from '../../engraving/GlyphScale'
import type { LayoutGlyph } from './types'

/** A decimal numeral, as `String(value)` spells a whole number. */
type Digit = '0' | '1' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9'

/**
 * An engraved number — a time signature's numerator or denominator, a tuplet's
 * ratio — as a run of Bravura `timeSig` digit glyphs set side by side. Each
 * digit is measured once; the run's width and its glyph positions both come
 * from those measurements, so multi-digit numbers (12/8, a 10-tuplet) space
 * by their real digit widths.
 */
export class DigitRun {
    /** The time-signature figure that draws each digit; tuplet numbers are set in the same figures. */
    private static readonly GLYPHS: Record<Digit, GlyphName> = {
        '0': 'timeSig0',
        '1': 'timeSig1',
        '2': 'timeSig2',
        '3': 'timeSig3',
        '4': 'timeSig4',
        '5': 'timeSig5',
        '6': 'timeSig6',
        '7': 'timeSig7',
        '8': 'timeSig8',
        '9': 'timeSig9',
    }

    readonly glyphNames: GlyphName[]
    readonly width: number
    private readonly _digitWidths: number[]

    constructor(
        value: number,
        private readonly scale: number = GLYPH_SCALE,
    ) {
        this.glyphNames = Array.from(String(value), (numeral) => {
            // The font has figures for 0–9 only: a sign, decimal point or NaN has nothing to draw.
            if (!DigitRun.isDigit(numeral)) throw new Error(`DigitRun engraves whole numbers; got ${value}`)
            return DigitRun.GLYPHS[numeral]
        })
        this._digitWidths = this.glyphNames.map((name) => Bravura.width(name, scale))
        this.width = sum(this._digitWidths)
    }

    private static isDigit(numeral: string): numeral is Digit {
        return Object.hasOwn(DigitRun.GLYPHS, numeral)
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
