import type { Beam } from '@/model'

interface BeamGroupProps {
    beam: Beam
}

export function BeamGroup({ beam }: BeamGroupProps) {
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
}
