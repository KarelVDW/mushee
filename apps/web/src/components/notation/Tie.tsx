import { memo } from 'react'

import type { TieSegment } from '@/model/layout/TieLayout'
import type { Tie as TieModel } from '@/model/Tie'

/** Outer bezier control point Y offset (thinner edge of tie) */
const TIE_CP1 = 8
/** Inner bezier control point Y offset (thicker edge of tie) */
const TIE_CP2 = 12

interface TieProps {
    tie: TieModel
    layoutId: string
    rowIndex: number
}

export const Tie = memo(function Tie({ tie, rowIndex }: TieProps) {
    const { segments, direction } = tie.layout
    return (
        <>
            {segments
                .filter((segment) => segment.rowIndex === rowIndex)
                .map((segment, i) => (
                    <path key={i} d={segmentPath(segment, direction)} fill="#000" />
                ))}
        </>
    )
})

function segmentPath({ startX, startY, endX, endY }: TieSegment, direction: 1 | -1) {
    let cp1 = TIE_CP1
    let cp2 = TIE_CP2
    if (Math.abs(endX - startX) < 10) {
        cp1 = 2
        cp2 = 8
    }
    const cpX = (startX + endX) / 2
    const outerCpY = (startY + endY) / 2 + cp1 * direction
    const innerCpY = (startY + endY) / 2 + cp2 * direction
    return [
        `M ${startX} ${startY}`,
        `Q ${cpX} ${outerCpY} ${endX} ${endY}`,
        `Q ${cpX} ${innerCpY} ${startX} ${startY}`,
        'Z',
    ].join(' ')
}
