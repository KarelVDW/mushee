import { TempoLayout } from './layout/TempoLayout'
import type { Measure } from './Measure'

/**
 * A tempo marking anchored in a measure. Immutable after construction; its
 * layout is a constant, so it is cached forever (context-free).
 */
export class Tempo {
    readonly id = crypto.randomUUID()
    private _layout: TempoLayout | null = null

    constructor(
        readonly measure: Measure,
        readonly beatPosition: number,
        readonly bpm: number,
    ) {}

    get layout(): TempoLayout {
        this._layout ||= new TempoLayout()
        return this._layout
    }
}
