import { getGlyphWidth, getYForNote } from '@/components/notation'
import { DOTTED_FLAG_SCALE, STAVE_LINE_DISTANCE } from '@/components/notation/constants'

import type { Note } from '../Note'
import type { NoteWidth } from '../width/NoteWidth'

/**
 * The geometry of a single note: notehead, stem, flag, ledger lines,
 * accidental, and dots. Context (the drawn accidental and the note's width)
 * is passed in explicitly by the layout layer — for detached preview notes,
 * by the note itself.
 */
export class NoteLayout {
    readonly id = crypto.randomUUID()
    readonly noteX: number
    readonly noteY: number
    readonly glyphName: string
    readonly width: NoteWidth
    readonly flag: { glyphName: string; x: number; y: number; scale?: number } | undefined
    readonly stem: { x: number; y1: number; y2: number } | undefined
    readonly ledgerLines: { x1: number; y1: number; x2: number; y2: number }[]
    readonly accidental: { x: number; y: number; glyphName: string } | undefined
    readonly dots: { x: number; y: number }[] | undefined

    constructor(
        note: Note,
        context: { accidentalGlyph: string | undefined; width: NoteWidth },
    ) {
        const width = context.width
        this.width = width
        this.noteY = getYForNote(note.line)
        this.glyphName = !note.pitch ? note.duration.restGlyph : note.duration.noteheadGlyph
        const hasStem = !!note.pitch && note.duration.type !== 'w'

        let cursorX = width.paddingLeft

        // accidental (key- and measure-aware: shown only when the alteration isn't already in effect)
        if (context.accidentalGlyph) {
            this.accidental = { x: cursorX, y: this.noteY, glyphName: context.accidentalGlyph }
            cursorX += getGlyphWidth(context.accidentalGlyph) + width.gap
        }

        // ledgerLines
        const ledgerLinePositions: number[] = []
        if (note.pitch) {
            const noteLine = note.line
            for (let l = 0; l >= noteLine; l--) ledgerLinePositions.push(getYForNote(l))
            for (let l = 6; l <= noteLine; l++) ledgerLinePositions.push(getYForNote(l))
        }
        this.ledgerLines = ledgerLinePositions.map((ly) => ({
            x1: cursorX,
            y1: ly,
            x2: cursorX + width.noteHeadWidth + 2 * width.ledgerLineExtension,
            y2: ly,
        }))
        cursorX += width.ledgerLineExtension

        this.noteX = cursorX

        // stem
        if (hasStem) {
            this.stem = this.getStem(note.stemDir)
            // flag
            const flagName = note.duration.flagGlyph(note.stemDir)
            if (flagName) {
                this.flag = {
                    glyphName: flagName,
                    x: this.stem.x,
                    y: this.noteY + (note.stemDir === 'up' ? -1 : 1) * width.stemHeight,
                    scale: note.duration.dots > 0 ? DOTTED_FLAG_SCALE : undefined,
                }
            }
        }

        cursorX += width.noteHeadWidth + width.ledgerLineExtension + width.gap

        // dots
        const numDots = note.duration.dots
        if (numDots && numDots > 0) {
            // If the note sits on a line (integer noteLine), shift dots up by half a space
            const onLine = Number.isInteger(note.line)
            const dotY = onLine ? this.noteY - STAVE_LINE_DISTANCE / 2 : this.noteY
            this.dots = []
            for (let i = 0; i < numDots; i++) {
                const offset = width.gap + width.dotSpacing
                this.dots.push({ x: cursorX + offset, y: dotY })
                cursorX += offset
            }
        }
    }

    getStem(stemDir: 'up' | 'down') {
        const stemX =
            stemDir === 'up'
                ? this.noteX + this.width.noteHeadWidth - this.width.stemWidth / 2
                : this.noteX + this.width.stemWidth / 2
        return stemDir === 'up'
            ? { x: stemX, y1: this.noteY, y2: this.noteY - this.width.stemHeight }
            : { x: stemX, y1: this.noteY, y2: this.noteY + this.width.stemHeight }
    }
}
