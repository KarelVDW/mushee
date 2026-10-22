import { memo } from 'react'

import type { TimeSignatureLayout } from '../model/layout/TimeSignatureLayout'
import { Glyph } from './Glyph'

export const TimeSignature = memo(function TimeSignature({ layout }: { layout: TimeSignatureLayout }) {
    const { topDigits, bottomDigits } = layout
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
})
