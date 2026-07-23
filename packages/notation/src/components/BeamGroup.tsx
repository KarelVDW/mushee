import { memo } from 'react'

import type { BeamLayout } from '../model/layout/BeamLayout'
import { NOTATION_INK } from './constants'

export const BeamGroup = memo(function BeamGroup({ beam }: { beam: BeamLayout; layoutId: string }) {
    const segments = [beam.primary, ...beam.secondaries]

    return (
        <g>
            {segments.map((seg, i) => (
                <path
                    key={i}
                    d={`M${seg.x1} ${seg.y1} L${seg.x1} ${seg.y1 + seg.thickness} L${seg.x2} ${seg.y2 + seg.thickness} L${seg.x2} ${seg.y2} Z`}
                    fill={NOTATION_INK}
                />
            ))}
        </g>
    )
})
