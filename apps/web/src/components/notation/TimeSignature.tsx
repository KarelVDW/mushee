import { memo } from 'react'

import type { TimeSignature as TimeSignatureModel } from '@/model'

import { Glyph } from './Glyph'

export const TimeSignature = memo(
    function TimeSignature({ timeSignature }: { timeSignature: TimeSignatureModel; layoutId: string }) {
        const { topDigits, bottomDigits } = timeSignature.layout
        return (
            <g>
                {topDigits.map((g, i) => (
                    <Glyph key={`top-${i}`} name={g.glyphName} x={g.x} y={g.y} />
                ))}
                {bottomDigits.map((g, i) => (
                    <Glyph key={`bot-${i}`} name={g.glyphName} x={g.x} y={g.y} />
                ))}
            </g>
        )
    },
)
