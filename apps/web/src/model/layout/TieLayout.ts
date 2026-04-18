import { TIE_Y_SHIFT } from '@/components/notation/constants'

import type { Tie } from '../Tie'

export interface TieSegment {
    rowIndex: number
    startX: number
    startY: number
    endX: number
    endY: number
}

export class TieLayout {
    readonly id = crypto.randomUUID()
    readonly direction: 1 | -1
    readonly segments: TieSegment[]

    constructor(tie: Tie) {
        const beam = tie.note.measure.beamOf(tie.note)
        this.direction = (beam?.stemDir ?? tie.note.stemDir) === 'up' ? 1 : -1
        const yShift = TIE_Y_SHIFT * this.direction

        const startMeasure = tie.note.measure
        const endMeasure = tie.nextNote.measure
        const startRow = startMeasure.score.getRowForMeasure(startMeasure)
        const endRow = endMeasure.score.getRowForMeasure(endMeasure)
        const startMeasureX = startRow.layout.getMeasureX(startMeasure)
        const endMeasureX = endRow.layout.getMeasureX(endMeasure)

        const startXInStartMeasure =
            startMeasure.layout.getXForElement(tie.note) + tie.note.layout.noteX + tie.note.width.noteHeadWidth
        const startY = tie.note.layout.noteY + yShift
        const endXInEndMeasure = endMeasure.layout.getXForElement(tie.nextNote) + tie.nextNote.layout.noteX
        const endY = tie.nextNote.layout.noteY + yShift

        if (startRow === endRow) {
            // Single segment drawn inside the start measure's group; convert endX to start-measure-local.
            this.segments = [
                {
                    rowIndex: startRow.index,
                    startX: startXInStartMeasure,
                    startY,
                    endX: endMeasureX - startMeasureX + endXInEndMeasure,
                    endY,
                },
            ]
        } else {
            // Two segments. Each is expressed in its own measure's local coordinate system —
            // seg 0 drawn inside the start measure's group, seg 1 inside the end measure's.
            this.segments = [
                {
                    rowIndex: startRow.index,
                    startX: startXInStartMeasure,
                    startY,
                    endX: startRow.layout.width - startMeasureX,
                    endY: startY,
                },
                {
                    rowIndex: endRow.index,
                    startX: -endMeasureX,
                    startY: endY,
                    endX: endXInEndMeasure,
                    endY,
                },
            ]
        }
    }
}
