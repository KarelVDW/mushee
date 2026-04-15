import { getGlyphWidth, getLedgerLinePositions, getYForNote } from '@/components/notation'
import { DOTTED_FLAG_SCALE, STAVE_LINE_DISTANCE } from '@/components/notation/constants'

import type { Note } from '../Note'

export class NoteLayout {
    readonly id = crypto.randomUUID()
    readonly noteX: number
    readonly noteY: number
    readonly glyphName: string
    readonly flag: { glyphName: string; x: number; y: number; scale?: number } | undefined
    readonly stem: { x: number; y1: number; y2: number } | undefined
    readonly ledgerLines: { x1: number; y1: number; x2: number; y2: number }[]
    readonly accidental: { x: number; y: number; glyphName: string } | undefined
    readonly dots: { x: number; y: number }[] | undefined

    constructor(note: Note) {
        this.noteY = getYForNote(note.pitch ? note.pitch.line : note.duration.restLine)
        this.glyphName = !note.pitch ? note.duration.restGlyph : note.duration.noteheadGlyph
        const hasStem = !!note.pitch && note.duration.type !== 'w'

        let cursorX = note.width.paddingLeft

        // accidental
        if (note.pitch?.accidental) {
            const accGlyph = note.pitch.accidentalGlyph
            if (accGlyph) {
                this.accidental = { x: cursorX, y: this.noteY, glyphName: accGlyph }
                cursorX += getGlyphWidth(accGlyph) + note.width.gap
            }
        }

        // ledgerLines
        this.ledgerLines = note.pitch
            ? getLedgerLinePositions(note.pitch.line).map((ly) => ({
                  x1: cursorX,
                  y1: ly,
                  x2: cursorX + note.width.noteHeadWidth + 2 * note.width.ledgerLineExtension,
                  y2: ly,
              }))
            : []
        cursorX += note.width.ledgerLineExtension

        this.noteX = cursorX

        // stem
        if (hasStem) {
            const stemX =
                note.stemDir === 'up'
                    ? cursorX + note.width.noteHeadWidth - (note.width.stemWidth ) / 2
                    : cursorX + note.width.stemWidth / 2
            this.stem =
                note.stemDir === 'up'
                    ? { x: stemX, y1: this.noteY, y2: this.noteY - note.width.stemHeight }
                    : { x: stemX, y1: this.noteY, y2: this.noteY + note.width.stemHeight }

            // flag
            if (!note.beam) {
                const flagName = note.duration.flagGlyph(note.stemDir)
                if (flagName) {
                    this.flag = {
                        glyphName: flagName,
                        x: stemX,
                        y: this.noteY + (note.stemDir === 'up' ? -1 : 1) * note.width.stemHeight,
                        scale: note.duration.dots > 0 ? DOTTED_FLAG_SCALE : undefined,
                    }
                }
            }
        }

        cursorX += note.width.noteHeadWidth + note.width.ledgerLineExtension + note.width.gap

        // dots
        const numDots = note.duration.dots
        if (numDots && numDots > 0) {
            // If the note sits on a line (integer noteLine), shift dots up by half a space
            const onLine = Number.isInteger(note.pitch ? note.pitch.line : note.duration.restLine)
            const dotY = onLine ? this.noteY - STAVE_LINE_DISTANCE / 2 : this.noteY
            this.dots = []
            for (let i = 0; i < numDots; i++) {
                const offset = note.width.gap + note.width.dotSpacing
                this.dots.push({ x: cursorX + offset, y: dotY })
                cursorX += offset
            }
        }
    }
}
