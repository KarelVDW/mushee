import { getGlyphWidth, getYForLine } from '@/components/notation'
import { CLEF_CONFIG, clefOctaveMarker, NUM_STAFF_LINES } from '@/components/notation/constants'

import { Clef } from '../Clef'

export class ClefLayout {
    readonly id = crypto.randomUUID()
    readonly glyphName: string
    readonly x: number
    readonly y: number
    /** The 8/15 octave marker drawn above or below the glyph, if the clef transposes. */
    readonly octave: { text: string; x: number; y: number } | undefined

    constructor(clef: Clef) {
        const config = CLEF_CONFIG[clef.type]
        if (!config) throw new Error(`Unknown clef type: ${clef.type}`)
        this.glyphName = config.glyphName
        this.x = clef.width.paddingLeft
        this.y = getYForLine(config.lineIndex)

        const marker = clefOctaveMarker(clef.type)
        this.octave = marker
            ? {
                  text: marker.text,
                  x: clef.width.paddingLeft + getGlyphWidth(config.glyphName) / 2,
                  y: marker.above ? getYForLine(0) - 6 : getYForLine(NUM_STAFF_LINES - 1) + 13,
              }
            : undefined
    }
}
