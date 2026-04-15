import { getGlyphWidth } from '@/components/notation'

import type { Note } from '../Note'
import { PhysicalWidth } from './PhysicalWidth'

export class NoteWidth implements PhysicalWidth {
    readonly paddingLeft: number = 4
    readonly paddingRight: number = 4
    readonly content: number
    readonly total: number
    readonly ledgerLineExtension = 4
    readonly gap = 1
    readonly dotSpacing = 4
    readonly noteHeadWidth = getGlyphWidth('noteheadBlack')
    readonly stemHeight = 35
    readonly stemWidth = 1.5

    constructor(note: Note) {
        let contentWidth = this.ledgerLineExtension * 2 + this.noteHeadWidth
        if (note.pitch?.accidentalGlyph) contentWidth += this.gap + getGlyphWidth(note.pitch.accidentalGlyph)
        if (note.duration.dots) contentWidth += this.gap + this.dotSpacing * note.duration.dots
        this.content = contentWidth
        this.total = this.paddingLeft + this.content + this.paddingRight
    }
}
