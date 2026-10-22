import { memo } from 'react'

import type { ClefLayout } from '../model/layout/ClefLayout'
import { NOTATION_INK } from './constants'
import { Glyph } from './Glyph'

export const Clef = memo(function Clef({ layout }: { layout: ClefLayout }) {
    const { glyphName, x, y, octave } = layout
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
                    fill={NOTATION_INK}
                    className="select-none">
                    {octave.text}
                </text>
            )}
        </>
    )
})
