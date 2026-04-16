import { getGlyphWidth } from '@/components/notation'
import { TUPLET_NUMBER_SCALE, TUPLET_OFFSET } from '@/components/notation/constants'
import type { LayoutGlyph } from '@/components/notation/types'

import type { Tuplet } from '../Tuplet'

export class TupletLayout {
    readonly id = crypto.randomUUID()
    readonly x1: number
    readonly x2: number
    readonly y: number
    readonly bracketed: boolean
    readonly location: 1 | -1
    readonly numberGlyphs: Array<{ glyphName: string; x: number; y: number }>
    constructor(tuplet: Tuplet) {
        const upCount = tuplet.notes.filter((n) => n.stemDir === 'up').length
        const stemDir = upCount >= tuplet.notes.length / 2 ? 'up' : 'down'
        this.x1 = tuplet.measure.layout.getXForElement(tuplet.firstNote) + tuplet.firstNote.layout.noteX
        this.x2 = tuplet.measure.layout.getXForElement(tuplet.lastNote) + tuplet.lastNote.layout.noteX + tuplet.lastNote.width.noteHeadWidth
        const stemTips = tuplet.notes.map((n) => n.layout.stem?.y2 ?? n.layout.noteY)
        this.y = stemDir === 'up' ? Math.min(...stemTips) - TUPLET_OFFSET : Math.max(...stemTips) + TUPLET_OFFSET
        this.bracketed = !tuplet.notes.every((n) => n.layout.flag === undefined && n.duration.isBeamable)
        this.location = stemDir === 'up' ? 1 : -1

        const { actualNotes: numNotes } = tuplet.notes[0].duration.ratio
        const glyphNames = String(numNotes)
            .split('')
            .map((d) => `timeSig${d}`)
        const scale = TUPLET_NUMBER_SCALE
        const totalWidth = glyphNames.reduce((sum, name) => sum + getGlyphWidth(name, scale), 0)
        let x = (this.x1 + this.x2) / 2 - totalWidth / 2
        const y = this.y
        const glyphs: LayoutGlyph[] = []
        // Numerator digits
        for (const name of glyphNames) {
            glyphs.push({ glyphName: name, x, y })
            x += getGlyphWidth(name, scale)
        }
        this.numberGlyphs = glyphs
    }
}
