import { getYForLine } from '@/components/notation'
import { CLEF_CONFIG } from '@/components/notation/constants'

import { Clef } from '../Clef'

export class ClefLayout {
    readonly id = crypto.randomUUID()
    readonly glyphName: string
    readonly x: number
    readonly y: number

    constructor(clef: Clef) {
        const config = CLEF_CONFIG[clef.type]
        if (!config) throw new Error(`Unknown clef type: ${clef.type}`)
        this.glyphName = config.glyphName
        this.x = clef.width.paddingLeft
        this.y = getYForLine(config.lineIndex)
    }
}
