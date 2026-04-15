import { TEMPO_MARKING_Y } from '@/components/notation/constants'

import type { Tempo } from '../Tempo'

export class TempoLayout {
    readonly id = crypto.randomUUID()
    readonly y = TEMPO_MARKING_Y
    constructor(_tempo: Tempo) {}
}
