import { memo } from 'react'

import type { KeySignatureLayout } from '../model/layout/KeySignatureLayout'
import { Glyph } from './Glyph'

export const KeySignature = memo(function KeySignature({ layout }: { layout: KeySignatureLayout }) {
    return (
        <g>
            {layout.accidentals.map((a, i) => (
                <Glyph key={i} name={a.glyphName} x={a.x} y={a.y} />
            ))}
        </g>
    )
})
