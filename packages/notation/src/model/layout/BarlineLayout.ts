import { sum } from 'lodash-es'

import { BARLINE_GAP, BARLINE_THICK_WIDTH, BARLINE_THIN_WIDTH } from '../../engraving/constants'
import type { BarlineType } from '../types'
import { Staff } from './Staff'

/** A barline type that draws ink — 'none' gets no layout at all. */
export type DrawnBarlineType = Exclude<BarlineType, 'none'>

/** Stroke widths left to right, BARLINE_GAP apart — the one table both the width and the strokes derive from. */
const STROKE_WIDTHS: Record<DrawnBarlineType, number[]> = {
    single: [BARLINE_THIN_WIDTH],
    double: [BARLINE_THIN_WIDTH, BARLINE_THIN_WIDTH],
    end: [BARLINE_THIN_WIDTH, BARLINE_THICK_WIDTH],
}

/**
 * The geometry of one barline: its thin/thick strokes, spanning the staff from
 * the top line to the bottom one. Built by MeasureLayout (the end barline) and
 * RowLayout (the opening barline), in their local coordinates.
 */
export class BarlineLayout {
    readonly id = crypto.randomUUID()
    readonly y = Staff.TOP_Y
    readonly height = Staff.HEIGHT
    /** Each stroke's x (in the same coordinates as `x`) and width, left to right. */
    readonly strokes: { x: number; width: number }[]

    constructor(
        readonly type: DrawnBarlineType,
        readonly x: number,
    ) {
        let strokeX = x
        this.strokes = STROKE_WIDTHS[type].map((width) => {
            const stroke = { x: strokeX, width }
            strokeX += width + BARLINE_GAP
            return stroke
        })
    }

    /** Horizontal space a barline of `type` occupies; an unset type is the default single barline. */
    static widthOf(type: BarlineType | undefined): number {
        if (type === 'none') return 0
        const widths = STROKE_WIDTHS[type ?? 'single']
        return sum(widths) + BARLINE_GAP * (widths.length - 1)
    }
}
