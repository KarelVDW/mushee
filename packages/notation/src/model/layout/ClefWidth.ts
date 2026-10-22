import { Bravura, type GlyphName } from '../../engraving/Bravura'
import { CLEF_DEFS, type ClefSign } from '../clefs'
import type { ClefType } from '../types'
import type { PhysicalWidth } from './PhysicalWidth'

const CLEF_GLYPH: Record<ClefSign, GlyphName> = { G: 'gClef', F: 'fClef', C: 'cClef' }

/**
 * A clef's horizontal footprint, and the glyph it measured (which ClefLayout
 * draws). Depends only on the clef type, so one instance per type is shared.
 */
export class ClefWidth implements PhysicalWidth {
    private static readonly byType = new Map<ClefType, ClefWidth>()

    readonly paddingLeft: number = 4
    readonly paddingRight: number = 4
    readonly glyphName: GlyphName
    readonly content: number
    readonly total: number

    constructor(type: ClefType) {
        this.glyphName = CLEF_GLYPH[CLEF_DEFS[type].sign]
        this.content = Bravura.width(this.glyphName)
        this.total = this.paddingLeft + this.content + this.paddingRight
    }

    /** The shared width for `type`. */
    static of(type: ClefType): ClefWidth {
        let width = ClefWidth.byType.get(type)
        if (!width) {
            width = new ClefWidth(type)
            ClefWidth.byType.set(type, width)
        }
        return width
    }
}
