import { TEMPO_MARKING_Y } from '@/components/notation/constants'

import type { Tempo } from '../Tempo'

export class TempoLayout {
    constructor(private tempo: Tempo) {}

    get x() {
        return this.tempo.note.layout.x
    }

    get y() {
        return TEMPO_MARKING_Y
    }
}
