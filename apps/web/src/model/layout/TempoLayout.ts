import { TEMPO_MARKING_Y } from '@/components/notation/constants'

import type { Tempo } from '../Tempo'

export class TempoLayout {
    constructor(private tempo: Tempo) {}

    get x() {
        return this.tempo.measure.layout.getX(this.tempo.beatPosition)
    }

    get y() {
        return TEMPO_MARKING_Y
    }
}
