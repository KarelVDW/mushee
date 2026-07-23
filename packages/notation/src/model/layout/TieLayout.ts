import { TIE_Y_SHIFT } from '../../components/constants'
import type { Note } from '../Note'

export interface TieSegment {
    rowIndex: number
    startX: number
    startY: number
    endX: number
    endY: number
}

export interface TieLayoutContext {
    /** Curve direction: 1 bends down (stems up), −1 bends up. */
    direction: 1 | -1
    startRowIndex: number
    endRowIndex: number
    /** Width of the start note's row — a cross-row tie runs to the row's right edge. */
    startRowWidth: number
    /** Row-local x of the start note's right notehead edge / end note's left notehead edge. */
    startX: number
    startY: number
    endX: number
    endY: number
}

/**
 * The curve(s) of one tie, in row-local coordinates. A tie crossing a row
 * break renders as two segments, one per row. Built by ScoreLayout from the
 * semantic tie pairing plus the endpoint geometry.
 */
export class TieLayout {
    readonly id = crypto.randomUUID()
    readonly direction: 1 | -1
    readonly segments: TieSegment[]
    /** Input signature — ScoreLayout reuses the previous instance when it is unchanged. */
    readonly contextSignature: string

    constructor(
        readonly note: Note,
        readonly nextNote: Note,
        context: TieLayoutContext,
    ) {
        this.direction = context.direction
        const yShift = TIE_Y_SHIFT * context.direction
        const startY = context.startY + yShift
        const endY = context.endY + yShift

        if (context.startRowIndex === context.endRowIndex) {
            this.segments = [{ rowIndex: context.startRowIndex, startX: context.startX, startY, endX: context.endX, endY }]
        } else {
            // Two segments: the first runs to the start row's right edge, the second starts at the end row's left edge.
            this.segments = [
                { rowIndex: context.startRowIndex, startX: context.startX, startY, endX: context.startRowWidth, endY: startY },
                { rowIndex: context.endRowIndex, startX: 0, startY: endY, endX: context.endX, endY },
            ]
        }
        this.contextSignature = TieLayout.signatureFor(context)
    }

    static signatureFor(context: TieLayoutContext): string {
        return [
            context.direction,
            context.startRowIndex,
            context.endRowIndex,
            context.startRowWidth,
            context.startX,
            context.startY,
            context.endX,
            context.endY,
        ].join('|')
    }
}
