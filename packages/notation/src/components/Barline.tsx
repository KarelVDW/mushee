import type { BarlineLayout } from '../model/layout/BarlineLayout'
import { NOTATION_INK } from './constants'

interface BarlineProps {
    layout: BarlineLayout
}

export function Barline({ layout }: BarlineProps) {
    return (
        <>
            {layout.strokes.map((stroke, i) => (
                <rect key={i} x={stroke.x} y={layout.y} width={stroke.width} height={layout.height} fill={NOTATION_INK} />
            ))}
        </>
    )
}
