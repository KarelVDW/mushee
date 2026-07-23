import { memo } from 'react'

import type { Clef as ClefModel } from '../model/Clef'
import { Glyph } from './Glyph'

export const Clef = memo(function Clef({ clef }: { clef: ClefModel; layoutId: string }) {
    const { glyphName, x, y, octave } = clef.layout
    return (
        <>
            <Glyph name={glyphName} x={x} y={y} />
            {octave && (
                <text
                    x={octave.x}
                    y={octave.y}
                    fontSize={9}
                    fontFamily="system-ui, sans-serif"
                    fontWeight={600}
                    textAnchor="middle"
                    dominantBaseline="middle"
                    style={{ userSelect: 'none' }}>
                    {octave.text}
                </text>
            )}
        </>
    )
})
