import { memo } from 'react'

import type { Beam } from '@/model'

export const BeamGroup = memo(
    function BeamGroup({ beam }: { beam: Beam }) {
        const segments = [beam.layout.primary, ...beam.layout.secondaries]

        return (
            <g>
                {segments.map((seg, i) => (
                    <path
                        key={i}
                        d={`M${seg.x1} ${seg.y1} L${seg.x1} ${seg.y1 + seg.thickness} L${seg.x2} ${seg.y2 + seg.thickness} L${seg.x2} ${seg.y2} Z`}
                        fill="#000"
                    />
                ))}
            </g>
        )
    },
    (prev, next) => prev.beam.layout.id === next.beam.layout.id,
)
