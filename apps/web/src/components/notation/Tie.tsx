import type { LayoutTie } from './types'

/** Outer bezier control point Y offset (thinner edge of tie) */
const TIE_CP1 = 8
/** Inner bezier control point Y offset (thicker edge of tie) */
const TIE_CP2 = 12

interface TieProps {
    layout: LayoutTie
}

export function Tie({ layout }: TieProps) {
    const { startX, startY, endX, endY, direction } = layout

    // Reduce curvature for very close notes
    let cp1 = TIE_CP1
    let cp2 = TIE_CP2
    if (Math.abs(endX - startX) < 10) {
        cp1 = 2
        cp2 = 8
    }

    // Control point X at midpoint between notes
    const cpX = (startX + endX) / 2

    // Two control point Y values create the tie thickness
    const outerCpY = (startY + endY) / 2 + cp1 * direction
    const innerCpY = (startY + endY) / 2 + cp2 * direction

    // Two quadratic bezier curves: outer edge and inner edge
    const d = [
        `M ${startX} ${startY}`,
        `Q ${cpX} ${outerCpY} ${endX} ${endY}`,
        `Q ${cpX} ${innerCpY} ${startX} ${startY}`,
        'Z',
    ].join(' ')

    return <path d={d} fill="#000" />
}
