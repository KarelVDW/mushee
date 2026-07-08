'use client'

import { useMemo } from 'react'

import { GLYPH_SCALE, NOTATION_INK } from './constants'
import { BravuraFont } from './fonts/bravura_glyphs'
import { outlineToSvgPath } from './glyphUtils'

interface GlyphProps {
    name: string
    x: number
    y: number
    scale?: number
    fill?: string
}

export function Glyph({ name, x, y, scale = GLYPH_SCALE, fill = NOTATION_INK }: GlyphProps) {
    const d = useMemo(() => {
        const glyph = BravuraFont.glyphs[name as keyof typeof BravuraFont.glyphs]
        if (!glyph) return ''
        return outlineToSvgPath(glyph.o, scale)
    }, [name, scale])

    if (!d) return null

    return <path d={d} transform={`translate(${x},${y})`} fill={fill} />
}
