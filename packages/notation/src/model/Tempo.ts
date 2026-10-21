import type { Duration } from './Duration'
import type { TempoLayout } from './layout/TempoLayout'
import type { Measure } from './Measure'

/**
 * A tempo marking anchored in a measure. `bpm` is always in quarter-note units
 * (the unit playback, MIDI and the transcription grid run on); the marking is
 * *written* in the measure's felt beat — `♩ = 90` in 4/4, `♩. = 60` in 6/8,
 * `𝅗𝅥 = 45` in 2/2 — see `pulse`/`pulseBpm`. Immutable after construction; its
 * layout (the marking's x at its beat) comes from the measure's layout.
 */
export class Tempo {
    readonly id = crypto.randomUUID()

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
        return this.measure.layout.tempoLayoutFor(this)
    }
}
