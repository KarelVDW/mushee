import { getGlyphWidth } from '../../components'
import type { KeyAccidental } from '../KeySignature'
import { PhysicalWidth } from './PhysicalWidth'

/** Horizontal gap between adjacent key-signature accidentals. */
const ACCIDENTAL_GAP = 2

export class KeySignatureWidth implements PhysicalWidth {
    readonly paddingLeft: number
    readonly paddingRight: number
    readonly content: number
    readonly total: number

    /** `drawnAccidentals` is the key's contextual drawn form (own accidentals or cancellation naturals). */
    constructor(drawnAccidentals: KeyAccidental[]) {
        if (drawnAccidentals.length === 0) {
            // C major (no accidentals) occupies no horizontal space.
            this.paddingLeft = 0
            this.paddingRight = 0
            this.content = 0
            this.total = 0
            return
        }
        this.paddingLeft = 4
        this.paddingRight = 8
        this.content = drawnAccidentals.reduce((sum, a) => sum + getGlyphWidth(a.glyphName) + ACCIDENTAL_GAP, 0)
        this.total = this.paddingLeft + this.content + this.paddingRight
    }
}
