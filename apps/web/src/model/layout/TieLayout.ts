import { getGlyphWidth } from '@/components/notation'
import { TIE_Y_SHIFT } from '@/components/notation/constants'

import type { Tie } from '../Tie'

const NOTEHEAD_WIDTH = getGlyphWidth('noteheadBlack')

export class TieLayout {
    readonly id = crypto.randomUUID()
    constructor(private tie: Tie) {}

    get startX() {
        return this.tie.note.layout.x + NOTEHEAD_WIDTH
    }

    get startY() {
        return this.tie.note.layout.y + this.yShift
    }

    get endX() {
        return this.tie.nextNote.layout.x
    }

    get endY() {
        return this.tie.nextNote.layout.y + this.yShift
    }

    get direction(): 1 | -1 {
        const stem = this.tie.note.layout.stem
        const stemUp = stem ? stem.y2 < stem.y1 : true
        return stemUp ? 1 : -1
    }

    private get yShift() {
        return TIE_Y_SHIFT * this.direction
    }
}
