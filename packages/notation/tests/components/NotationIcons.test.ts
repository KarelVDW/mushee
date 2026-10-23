import { isValidElement, type ReactElement, type ReactNode } from 'react'
import { describe, expect, it } from 'vitest'

import { Glyph } from '../../src/components/Glyph'
import { KeySignatureIcon } from '../../src/components/NotationIcons'
import { Staff } from '../../src/model/layout/Staff'

type Props = Record<string, unknown> & { children?: ReactNode }

/**
 * The host elements (and Glyphs, left unexpanded) `node` renders: function components other
 * than Glyph are called through — these icons are hook-free.
 */
function hosts(node: ReactNode): ReactElement<Props>[] {
    if (Array.isArray(node)) return node.flatMap(hosts)
    if (!isValidElement<Props>(node)) return []
    if (typeof node.type === 'function' && node.type !== Glyph) {
        return hosts((node.type as (props: Props) => ReactNode)(node.props))
    }
    return [node, ...hosts(node.props.children)]
}

const icon = (props: Parameters<typeof KeySignatureIcon>[0]) => hosts(KeySignatureIcon(props))
const svgOf = (elements: ReactElement<Props>[]) => elements.find((el) => el.type === 'svg')?.props as Props
const glyphs = (elements: ReactElement<Props>[]) => elements.filter((el) => el.type === Glyph)
const lines = (elements: ReactElement<Props>[]) => elements.filter((el) => el.type === 'line')

describe('KeySignatureIcon', () => {
    it('draws the bare accidentals in a size-tall window, C major as a natural', () => {
        const d = icon({ fifths: 2, size: 32 })
        expect(svgOf(d).height).toBe(32)
        expect(glyphs(d).map((g) => g.props.name)).toEqual(['accidentalSharp', 'accidentalSharp'])
        expect(lines(d)).toHaveLength(0)
        expect(glyphs(icon({ fifths: 0 })).map((g) => g.props.name)).toEqual(['accidentalNatural'])
    })

    it('with a staff, draws five faint lines behind the accidentals, the staff `size` px tall', () => {
        const d = icon({ fifths: -3, size: 24, staff: true })
        const staffLines = lines(d)
        expect(staffLines.map((line) => line.props.y1)).toEqual([0, 1, 2, 3, 4].map((i) => Staff.yForStaffLine(i)))
        for (const line of staffLines) {
            expect(line.props).toMatchObject({ strokeOpacity: 0.4, strokeWidth: 1, vectorEffect: 'non-scaling-stroke' })
            expect(line.props.stroke).toContain('--color-outline-variant')
        }
        // The lines come first, so the accidentals are drawn over them.
        expect(d.findIndex((el) => el.type === Glyph)).toBeGreaterThan(d.findIndex((el) => el.type === 'line'))
        expect(glyphs(d)).toHaveLength(3)
        // 24px for the staff's 40 units: 0.6px a unit, over the 66-unit window every key shares.
        const svg = svgOf(d)
        expect(svg.height).toBeCloseTo(66 * 0.6, 6)
        expect(svg.viewBox).toMatch(/^0 19 /)
        expect(svgOf(icon({ fifths: 7, size: 24, staff: true })).viewBox).toMatch(/^0 19 /)
    })

    it('centres the run across a wider staff', () => {
        const d = icon({ fifths: 1, size: 24, staff: true, width: 40 })
        const svg = svgOf(d)
        expect(svg.width).toBeCloseTo(40, 6)
        const viewWidth = Number(String(svg.viewBox).split(' ')[2])
        const [sharp] = glyphs(d)
        // The suite's glyph double makes a sharp 8 units wide.
        expect(sharp.props.x).toBeCloseTo((viewWidth - 8) / 2, 6)
    })

    it('steps a staffed run by each accidental’s own width, so they never overlap', () => {
        const xs = glyphs(icon({ fifths: 3, size: 24, staff: true })).map((g) => Number(g.props.x))
        // 8-unit sharps, half a unit apart.
        expect(xs[1] - xs[0]).toBeCloseTo(8.5, 6)
        expect(xs[2] - xs[1]).toBeCloseTo(8.5, 6)
    })

    it('draws C major on a staff as the empty staff alone, cropped round its lines', () => {
        const d = icon({ fifths: 0, size: 24, staff: true, width: 40 })
        expect(glyphs(d)).toHaveLength(0)
        expect(lines(d)).toHaveLength(5)
        expect(svgOf(d).height).toBeCloseTo((Staff.HEIGHT + 4) * 0.6, 6)
        expect(svgOf(d).width).toBeCloseTo(40, 6)
    })
})
