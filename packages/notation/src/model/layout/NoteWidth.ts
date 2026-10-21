import { Bravura } from '../../engraving/Bravura'
import { DOT_SPACING, LEDGER_LINE_EXTENSION, NOTE_ELEMENT_GAP } from '../../engraving/constants'
import type { Note } from '../Note'
import type { PhysicalWidth } from './PhysicalWidth'

/** A note's horizontal footprint: accidental, notehead (or rest) with its ledger-line reach, and dots. */
export class NoteWidth implements PhysicalWidth {
    readonly paddingLeft: number = 4
    readonly paddingRight: number = 4
    readonly content: number
    readonly total: number
    /** The glyph drawn at the note's head — its notehead, or the rest glyph for a rest — which NoteLayout draws. */
    readonly headGlyph: string
    /** Width of `headGlyph`. */
    readonly noteHeadWidth: number
    /** The accidental drawn before the head, if any (measure- and key-aware, resolved by the layout layer) — which NoteLayout draws. */
    readonly accidentalGlyph: string | undefined

    constructor(note: Note, accidentalGlyph: string | undefined) {
        this.accidentalGlyph = accidentalGlyph
        this.headGlyph = note.pitch ? note.duration.noteheadGlyph : note.duration.restGlyph
        this.noteHeadWidth = Bravura.width(this.headGlyph)
        let contentWidth = LEDGER_LINE_EXTENSION * 2 + this.noteHeadWidth
        if (accidentalGlyph) contentWidth += NOTE_ELEMENT_GAP + Bravura.width(accidentalGlyph)
        if (note.duration.dots) contentWidth += NOTE_ELEMENT_GAP + DOT_SPACING * note.duration.dots
        this.content = contentWidth
        this.total = this.paddingLeft + this.content + this.paddingRight
    }
}
