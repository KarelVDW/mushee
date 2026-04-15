import { getGlyphWidth } from '@/components/notation'
import { CLEF_CONFIG } from '@/components/notation/constants'

import { Clef } from '../Clef'
import { PhysicalWidth } from './PhysicalWidth'

export class ClefWidth implements PhysicalWidth {
    readonly paddingLeft: number = 4
    readonly paddingRight: number = 4
    readonly content: number
    readonly total: number

    constructor(clef: Clef) {
        const config = CLEF_CONFIG[clef.type]
        if (!config) throw new Error(`Unknown clef type: ${clef.type}`)
        this.content = getGlyphWidth(config.glyphName)
        this.total = this.paddingLeft + this.content + this.paddingRight
    }
}
