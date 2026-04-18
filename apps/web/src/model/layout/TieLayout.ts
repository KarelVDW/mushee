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
        const startMeasure = tie.note.measure
        const endMeasure = tie.nextNote.measure
        const startRow = startMeasure.score.getRowForMeasure(startMeasure)
        const endRow = endMeasure.score.getRowForMeasure(endMeasure)
        const measureXOffset = endRow.layout.getMeasureX(endMeasure) - startRow.layout.getMeasureX(startMeasure)
        this.startX = startMeasure.layout.getXForElement(tie.note) + tie.note.layout.noteX + tie.note.width.noteHeadWidth
        this.startY = tie.note.layout.noteY + yShift
        this.endX = measureXOffset + endMeasure.layout.getXForElement(tie.nextNote) + tie.nextNote.layout.noteX
        this.endY = tie.nextNote.layout.noteY + yShift
    }
}
