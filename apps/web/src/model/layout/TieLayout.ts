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
        const startRow = tie.note.measure.score.getRowForMeasure(tie.note.measure)
        this.startX = startRow.layout.getMeasureX(tie.note.measure) + tie.note.layout.noteX + tie.note.width.noteHeadWidth
        this.startY = tie.note.layout.noteY + yShift
        const endRow = tie.nextNote.measure.score.getRowForMeasure(tie.nextNote.measure)
        this.endX = endRow.layout.getMeasureX(tie.nextNote.measure) +  tie.nextNote.layout.noteX
        this.endY = tie.nextNote.layout.noteY + yShift
    }
}
