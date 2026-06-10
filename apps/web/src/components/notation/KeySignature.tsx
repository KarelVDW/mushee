import { memo } from 'react'

import type { KeySignature as KeySignatureModel } from '@/model/KeySignature'

import { Glyph } from './Glyph'

export const KeySignature = memo(function KeySignature({ keySignature }: { keySignature: KeySignatureModel; layoutId: string }) {
    return (
        <g>
            {keySignature.layout.accidentals.map((a, i) => (
                <Glyph key={i} name={a.glyphName} x={a.x} y={a.y} />
            ))}
        </g>
    )
})
