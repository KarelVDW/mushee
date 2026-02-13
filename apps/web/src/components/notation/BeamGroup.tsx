import type { LayoutBeamSegment } from './types'

interface BeamGroupProps {
    segments: LayoutBeamSegment[]
}

export function BeamGroup({ segments }: BeamGroupProps) {
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
}
