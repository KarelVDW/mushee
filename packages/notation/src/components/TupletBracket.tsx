import { memo } from 'react'

import type { TupletLayout } from '../model/layout/TupletLayout'
import { NOTATION_INK } from './constants'
import { Glyph } from './Glyph'

export const TupletBracket = memo(function TupletBracket({ layout }: { layout: TupletLayout }) {
    const { bracket, numberGlyphs } = layout
    return (
        <g>
            {bracket.map((rect, i) => (
                <rect key={i} x={rect.x} y={rect.y} width={rect.width} height={rect.height} fill={NOTATION_INK} />
            ))}
            {numberGlyphs.map((glyph, i) => (
                <Glyph key={i} name={glyph.glyphName} x={glyph.x} y={glyph.y} scale={glyph.scale} />
            ))}
        </g>
    )
})
