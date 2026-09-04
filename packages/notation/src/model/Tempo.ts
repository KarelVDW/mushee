import type { Duration } from './Duration'
import { TempoLayout } from './layout/TempoLayout'
import type { Measure } from './Measure'

/**
 * A tempo marking anchored in a measure. `bpm` is always in quarter-note units
 * (the unit playback, MIDI and the transcription grid run on); the marking is
 * *written* in the measure's felt beat — `♩ = 90` in 4/4, `♩. = 60` in 6/8,
 * `𝅗𝅥 = 45` in 2/2 — see `pulse`/`pulseBpm`. Immutable after construction; its
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

    /** The beat this marking is written in — the time signature's felt beat at this measure. */
    get pulse(): Duration {
        return this.measure.timeSignature.pulse
    }

    /** `bpm` counted in the written beat, rounded to a whole number for display (60 for 90 quarter-bpm in 6/8). */
    get pulseBpm(): number {
        return Math.round(this.measure.timeSignature.pulseBpmOf(this.bpm))
    }

    get layout(): TempoLayout {
        this._layout ||= new TempoLayout()
        return this._layout
    }
}
