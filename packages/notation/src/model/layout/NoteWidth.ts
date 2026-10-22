import { Bravura } from '../../engraving/Bravura'
import { DOT_RADIUS, DOT_SPACING, LEDGER_LINE_EXTENSION, NOTE_ELEMENT_GAP } from '../../engraving/constants'
import type { Note } from '../Note'
import type { PhysicalWidth } from './PhysicalWidth'

/**
 * A note's horizontal footprint and the slots inside it: accidental, notehead (or
 * rest) with its ledger-line reach, and dots. Width and positions come from one
 * walk, so what NoteLayout draws always fits what the measure reserved.
 */
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
    /** Note-local x of `accidentalGlyph`; undefined when none is drawn. */
    readonly accidentalX: number | undefined
    /** Note-local x of the head's left edge (ledger lines reach LEDGER_LINE_EXTENSION further each side). */
    readonly noteX: number
    /** Note-local x of each augmentation dot's centre, left to right. */
    readonly dotXs: number[]

    constructor(note: Note, accidentalGlyph: string | undefined) {
        this.accidentalGlyph = accidentalGlyph
        this.headGlyph = note.pitch ? note.duration.noteheadGlyph : note.duration.restGlyph
        this.noteHeadWidth = Bravura.width(this.headGlyph)

        let x = this.paddingLeft
        if (accidentalGlyph) {
            this.accidentalX = x
            x += Bravura.width(accidentalGlyph) + NOTE_ELEMENT_GAP
        }
        this.noteX = x + LEDGER_LINE_EXTENSION
        const headEnd = this.noteX + this.noteHeadWidth + LEDGER_LINE_EXTENSION

        // Dots trail the head's ledger reach, each a further gap + spacing along.
        this.dotXs = []
        let dotX = this.noteX + (this.noteHeadWidth + LEDGER_LINE_EXTENSION + NOTE_ELEMENT_GAP)
        for (let i = 0; i < note.duration.dots; i++) {
            dotX += NOTE_ELEMENT_GAP + DOT_SPACING
            this.dotXs.push(dotX)
        }
        const lastDotX = this.dotXs.at(-1)
        this.content = (lastDotX === undefined ? headEnd : lastDotX + DOT_RADIUS) - this.paddingLeft
        this.total = this.paddingLeft + this.content + this.paddingRight
    }
}
