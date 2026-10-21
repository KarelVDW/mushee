import { TEMPO_MARKING_Y } from '../../engraving/constants'

/**
 * Where a tempo marking sits: at its beat's x in the measure (measure-local),
 * in the headroom above the staff. Built by MeasureLayout, so the snapshot —
 * and the marking's memo key — changes whenever the beat spacing does.
 */
export class TempoLayout {
    readonly id = crypto.randomUUID()
    readonly x: number
    readonly y = TEMPO_MARKING_Y

    constructor(context: { x: number }) {
        this.x = context.x
    }
}
