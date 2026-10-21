import { Bravura } from '../../engraving/Bravura'
import type { Clef } from '../Clef'
import { CLEF_DEFS, type ClefDef, type ClefSign } from '../clefs'
import type { ClefType } from '../types'
import { Staff } from './Staff'

const CLEF_GLYPH: Record<ClefSign, string> = { G: 'gClef', F: 'fClef', C: 'cClef' }

export class ClefLayout {
    readonly id = crypto.randomUUID()
    readonly glyphName: string
    readonly x: number
    readonly y: number
    /** The 8/15 octave marker drawn above or below the glyph, if the clef transposes. */
    readonly octave: { text: string; x: number; y: number } | undefined

    constructor(clef: Clef) {
        const config = ClefLayout.glyphFor(clef.type)
        this.glyphName = config.glyphName
        this.x = clef.width.paddingLeft
        this.y = Staff.yForStaffLine(config.lineIndex)

        const marker = ClefLayout.octaveMarker(clef.type)
        this.octave = marker
            ? {
                  text: marker.text,
                  x: clef.width.paddingLeft + Bravura.width(config.glyphName) / 2,
                  y: marker.above ? Staff.TOP_Y - 6 : Staff.TOP_Y + Staff.HEIGHT + 13,
              }
            : undefined
    }

    /** Clef glyph name and the staff-line index (0 = top line) the glyph anchors on. */
    static glyphFor(type: ClefType): { glyphName: string; lineIndex: number } {
        const def = CLEF_DEFS[type] as ClefDef | undefined
        if (!def) throw new Error(`Unknown clef type: ${type}`)
        return { glyphName: CLEF_GLYPH[def.sign], lineIndex: 5 - def.line }
    }

    /** The octave marker ("8" or "15", above or below) shown on a clef, if it transposes. */
    static octaveMarker(type: ClefType): { text: string; above: boolean } | undefined {
        const oc = CLEF_DEFS[type].octaveChange
        if (oc === 0) return undefined
        return { text: Math.abs(oc) === 2 ? '15' : '8', above: oc > 0 }
    }
}
