import { BARLINE_GAP, BARLINE_THICK_WIDTH, BARLINE_THIN_WIDTH, NOTATION_INK } from './constants'
import type { LayoutBarline } from './types'

interface BarlineProps {
    layout: LayoutBarline
}

export function Barline({ layout }: BarlineProps) {
    const { x, y, height, type } = layout

    switch (type) {
        case 'none':
            return null

        case 'single':
            return <rect x={x} y={y} width={BARLINE_THIN_WIDTH} height={height} fill={NOTATION_INK} />

        case 'double':
            return (
                <g>
                    <rect x={x} y={y} width={BARLINE_THIN_WIDTH} height={height} fill={NOTATION_INK} />
                    <rect x={x + BARLINE_THIN_WIDTH + BARLINE_GAP} y={y} width={BARLINE_THIN_WIDTH} height={height} fill={NOTATION_INK} />
                </g>
            )

        case 'end':
            return (
                <g>
                    <rect x={x} y={y} width={BARLINE_THIN_WIDTH} height={height} fill={NOTATION_INK} />
                    <rect x={x + BARLINE_THIN_WIDTH + BARLINE_GAP} y={y} width={BARLINE_THICK_WIDTH} height={height} fill={NOTATION_INK} />
                </g>
            )
    }
}
