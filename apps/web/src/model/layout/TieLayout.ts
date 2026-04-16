import { TIE_Y_SHIFT } from '@/components/notation/constants'

import type { Tie } from '../Tie'

export class TieLayout {
    readonly id = crypto.randomUUID()
    readonly startX: number
    readonly startY: number
    readonly endX: number
    readonly endY: number
    readonly direction: 1 | -1

    constructor(tie: Tie) {
        const beam = tie.note.measure.beamOf(tie.note)
        this.direction = (beam?.stemDir ?? tie.note.stemDir) === 'up' ? 1 : -1
        const yShift = TIE_Y_SHIFT * this.direction
        this.startX = tie.note.measure.score.layout.getMeasureX(tie.note.measure) + tie.note.layout.noteX + tie.note.width.noteHeadWidth
        this.startY = tie.note.layout.noteY + yShift
        this.endX = tie.nextNote.measure.score.layout.getMeasureX(tie.nextNote.measure) +  tie.nextNote.layout.noteX
        this.endY = tie.nextNote.layout.noteY + yShift
    }
}
