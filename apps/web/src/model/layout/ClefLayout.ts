import { getGlyphWidth, getYForLine } from '@/components/notation'
import { CLEF_CONFIG, STAVE_LEFT_PADDING } from '@/components/notation/constants'

import { Clef } from '../Clef'

export class ClefLayout {
    readonly glyphName: string
    readonly width: number
    readonly x: number
    readonly y: number

    constructor(clef: Clef) {
        const config = CLEF_CONFIG[clef.type]
        if (!config) throw new Error(`Unknown clef type: ${clef.type}`)
        this.glyphName = config.glyphName
        this.width = getGlyphWidth(this.glyphName)
        this.x = clef.measure.layout.measureX + STAVE_LEFT_PADDING
        this.y = getYForLine(config.lineIndex)
    }
}
