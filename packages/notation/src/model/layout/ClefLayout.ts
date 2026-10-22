import type { GlyphName } from '../../engraving/Bravura'
import { CLEF_DEFS } from '../clefs'
import type { ClefType } from '../types'
import { ClefWidth } from './ClefWidth'
import { Staff } from './Staff'

/**
 * A clef's ink: the glyph anchored on its staff line, plus the 8/15 octave
 * marker of a transposing clef. Depends only on the clef type, so one instance
 * per type is shared — by every Clef of that type and by app-side clef pickers.
 */
export class ClefLayout {
    private static readonly byType = new Map<ClefType, ClefLayout>()

    readonly id = crypto.randomUUID()
    readonly width: ClefWidth
    readonly glyphName: GlyphName
    readonly x: number
    readonly y: number
    /** The 8/15 octave marker drawn above or below the glyph, if the clef transposes. */
    readonly octave: { text: string; x: number; y: number } | undefined

    constructor(type: ClefType) {
        const def = CLEF_DEFS[type]
        this.width = ClefWidth.of(type)
        this.glyphName = this.width.glyphName
        this.x = this.width.paddingLeft
        // MusicXML numbers clef lines from the bottom (1) up; staff line indices run from the top (0) down.
        this.y = Staff.yForStaffLine(5 - def.line)
        this.octave =
            def.octaveChange === 0
                ? undefined
                : {
                      text: Math.abs(def.octaveChange) === 2 ? '15' : '8',
                      x: this.x + this.width.content / 2,
                      y: def.octaveChange > 0 ? Staff.TOP_Y - 6 : Staff.TOP_Y + Staff.HEIGHT + 13,
                  }
    }

    /** The shared layout for `type`. */
    static of(type: ClefType): ClefLayout {
        let layout = ClefLayout.byType.get(type)
        if (!layout) {
            layout = new ClefLayout(type)
            ClefLayout.byType.set(type, layout)
        }
        return layout
    }
}
