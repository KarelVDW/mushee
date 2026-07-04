import { NOTATION_INK } from './constants'
import type { LayoutLine } from './types'

interface StaffLinesProps {
    lines: LayoutLine[]
}

export function StaffLines({ lines }: StaffLinesProps) {
    return (
        <g>
            {lines.map((line, i) => (
                <line key={i} x1={line.x1} y1={line.y1} x2={line.x2} y2={line.y2} stroke={NOTATION_INK} strokeWidth={1} />
            ))}
        </g>
    )
}
