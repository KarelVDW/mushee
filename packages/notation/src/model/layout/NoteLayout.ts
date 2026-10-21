import { Bravura } from '../../engraving/Bravura'
import {
    DOT_SPACING,
    DOTTED_FLAG_SCALE,
    LEDGER_LINE_EXTENSION,
    NOTE_ELEMENT_GAP,
    STAVE_LINE_DISTANCE,
    STEM_HEIGHT,
    STEM_WIDTH,
} from '../../engraving/constants'
import type { Note } from '../Note'
import { STAFF_BOTTOM_LINE, STAFF_TOP_LINE } from '../staffLines'
import type { StemDirection } from '../types'
import type { NoteWidth } from './NoteWidth'
import { Staff } from './Staff'
import type { LayoutGlyph, LayoutLine, LayoutStem } from './types'

/**
 * The geometry of a single note: notehead, stem, flag, ledger lines,
 * accidental, and dots. Context (the drawn accidental and the note's width)
 * is passed in explicitly by the layout layer — for detached preview notes,
 * by the note itself.
 */
export class NoteLayout {
    readonly id = crypto.randomUUID()
    readonly noteX: number
    /** x of the notehead's right edge — where a tie leaves and a tuplet bracket ends. */
    readonly noteRightX: number
    readonly noteY: number
    readonly glyphName: string
    readonly width: NoteWidth
    readonly flag: LayoutGlyph | undefined
    readonly stem: LayoutStem | undefined
    readonly ledgerLines: LayoutLine[]
    readonly accidental: LayoutGlyph | undefined
    readonly dots: { x: number; y: number }[] | undefined

    constructor(note: Note, context: { accidentalGlyph: string | undefined; width: NoteWidth }) {
        const width = context.width
        this.width = width
        this.noteY = Staff.yForNoteLine(note.line)
        this.glyphName = width.headGlyph
        const hasStem = !!note.pitch && note.duration.type !== 'w'

        let cursorX = width.paddingLeft

        // accidental (key- and measure-aware: shown only when the alteration isn't already in effect)
        if (context.accidentalGlyph) {
            this.accidental = { x: cursorX, y: this.noteY, glyphName: context.accidentalGlyph }
            cursorX += Bravura.width(context.accidentalGlyph) + NOTE_ELEMENT_GAP
        }

        // ledgerLines
        const ledgerLinePositions: number[] = []
        if (note.pitch) {
            const noteLine = note.line
            for (let l = STAFF_BOTTOM_LINE - 1; l >= noteLine; l--) ledgerLinePositions.push(Staff.yForNoteLine(l))
            for (let l = STAFF_TOP_LINE + 1; l <= noteLine; l++) ledgerLinePositions.push(Staff.yForNoteLine(l))
        }
        this.ledgerLines = ledgerLinePositions.map((ly) => ({
            x1: cursorX,
            y1: ly,
            x2: cursorX + width.noteHeadWidth + 2 * LEDGER_LINE_EXTENSION,
            y2: ly,
        }))
        cursorX += LEDGER_LINE_EXTENSION

        this.noteX = cursorX
        this.noteRightX = cursorX + width.noteHeadWidth

        // stem
        if (hasStem) {
            this.stem = this.getStem(note.stemDir)
            // flag
            const flagName = note.duration.flagGlyph(note.stemDir)
            if (flagName) {
                this.flag = {
                    glyphName: flagName,
                    x: this.stem.x,
                    y: this.noteY + (note.stemDir === 'up' ? -1 : 1) * STEM_HEIGHT,
                    scale: note.duration.dots > 0 ? DOTTED_FLAG_SCALE : undefined,
                }
            }
        }

        cursorX += width.noteHeadWidth + LEDGER_LINE_EXTENSION + NOTE_ELEMENT_GAP

        // dots
        const numDots = note.duration.dots
        if (numDots && numDots > 0) {
            // If the note sits on a line (integer noteLine), shift dots up by half a space
            const onLine = Number.isInteger(note.line)
            const dotY = onLine ? this.noteY - STAVE_LINE_DISTANCE / 2 : this.noteY
            this.dots = []
            for (let i = 0; i < numDots; i++) {
                const offset = NOTE_ELEMENT_GAP + DOT_SPACING
                this.dots.push({ x: cursorX + offset, y: dotY })
                cursorX += offset
            }
        }
    }

    getStem(stemDir: StemDirection): LayoutStem {
        return stemDir === 'up'
            ? { x: this.noteRightX - STEM_WIDTH / 2, y1: this.noteY, y2: this.noteY - STEM_HEIGHT }
            : { x: this.noteX + STEM_WIDTH / 2, y1: this.noteY, y2: this.noteY + STEM_HEIGHT }
    }
}
