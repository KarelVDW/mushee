import { TEMPO_MARKING_Y } from '../../engraving/constants'

export class TempoLayout {
    readonly id = crypto.randomUUID()
    readonly y = TEMPO_MARKING_Y
}
