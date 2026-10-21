import { BARLINE_GAP, BARLINE_THICK_WIDTH, BARLINE_THIN_WIDTH } from '@mushee/notation/engraving/constants'
import { BarlineLayout } from '@mushee/notation/model/layout/BarlineLayout'
import { Staff } from '@mushee/notation/model/layout/Staff'
import { describe, expect, it } from 'vitest'

describe('BarlineLayout', () => {
    describe('widthOf', () => {
        it('maps each barline type to its drawn width', () => {
            expect(BarlineLayout.widthOf('none')).toBe(0)
            expect(BarlineLayout.widthOf('single')).toBe(BARLINE_THIN_WIDTH)
            expect(BarlineLayout.widthOf('double')).toBe(BARLINE_THIN_WIDTH + BARLINE_GAP + BARLINE_THIN_WIDTH)
            expect(BarlineLayout.widthOf('end')).toBe(BARLINE_THIN_WIDTH + BARLINE_GAP + BARLINE_THICK_WIDTH)
            expect(BarlineLayout.widthOf(undefined)).toBe(BARLINE_THIN_WIDTH)
        })

        it('draws end and double barlines wider than a single one', () => {
            expect(BarlineLayout.widthOf('end')).toBeGreaterThan(BarlineLayout.widthOf('single'))
            expect(BarlineLayout.widthOf('double')).toBeGreaterThan(BarlineLayout.widthOf('single'))
        })
    })

    it('spans the staff from the top line to the bottom one', () => {
        const bar = new BarlineLayout('single', 12)
        expect(bar.x).toBe(12)
        expect(bar.y).toBe(Staff.TOP_Y)
        expect(bar.height).toBe(Staff.HEIGHT)
        expect(bar.type).toBe('single')
    })

    it('draws a single barline as one thin stroke at x', () => {
        expect(new BarlineLayout('single', 12).strokes).toEqual([{ x: 12, width: BARLINE_THIN_WIDTH }])
    })

    it('draws a double barline as two thin strokes a gap apart', () => {
        expect(new BarlineLayout('double', 12).strokes).toEqual([
            { x: 12, width: BARLINE_THIN_WIDTH },
            { x: 12 + BARLINE_THIN_WIDTH + BARLINE_GAP, width: BARLINE_THIN_WIDTH },
        ])
    })

    it('draws an end barline as a thin stroke then a thick one', () => {
        expect(new BarlineLayout('end', 12).strokes).toEqual([
            { x: 12, width: BARLINE_THIN_WIDTH },
            { x: 12 + BARLINE_THIN_WIDTH + BARLINE_GAP, width: BARLINE_THICK_WIDTH },
        ])
    })

    it('its strokes fill exactly the width it reserves', () => {
        for (const type of ['single', 'double', 'end'] as const) {
            const last = new BarlineLayout(type, 0).strokes.at(-1)
            if (!last) throw new Error('expected a stroke')
            expect(last.x + last.width).toBe(BarlineLayout.widthOf(type))
        }
    })
})
