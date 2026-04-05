import { memo } from 'react'

import type { Clef as ClefModel } from '@/model/Clef'

import { Glyph } from './Glyph'

export const Clef = memo(
    function Clef({ clef }: { clef: ClefModel; layoutId: string }) {
        const { glyphName, x, y } = clef.layout
        return <Glyph name={glyphName} x={x} y={y} />
    },
)
