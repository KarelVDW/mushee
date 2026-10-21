'use client'

import { Bravura } from '../engraving/Bravura'
import { GLYPH_SCALE } from '../engraving/GlyphScale'
import { NOTATION_INK } from './constants'

interface GlyphProps {
    name: string
    x: number
    y: number
    scale?: number
    fill?: string
}

export function Glyph({ name, x, y, scale = GLYPH_SCALE, fill = NOTATION_INK }: GlyphProps) {
    const d = Bravura.svgPath(name, scale)
    if (!d) return null

    return <path d={d} transform={`translate(${x},${y})`} fill={fill} />
}
