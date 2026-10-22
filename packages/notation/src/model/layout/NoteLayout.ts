import { DOTTED_FLAG_SCALE, LEDGER_LINE_EXTENSION, STAVE_LINE_DISTANCE, STEM_HEIGHT, STEM_WIDTH } from '../../engraving/constants'
import type { Clef } from '../Clef'
import type { Duration } from '../Duration'
import { Note } from '../Note'
import { STAFF_BOTTOM_LINE, STAFF_TOP_LINE } from '../staffLines'
import type { StemDirection } from '../types'
import { NoteWidth } from './NoteWidth'
import { Staff } from './Staff'
import type { LayoutGlyph, LayoutLine, LayoutStem } from './types'

/**
 * The geometry of a single note: notehead, stem, flag, ledger lines,
 * accidental, and dots. Context — the staff line the note sits on and its
 * width (which carries the drawn head and accidental and every horizontal
 * slot; this class adds the vertical geometry) — is passed in
 * explicitly by the layout layer: MeasureLayout for notes in the score,
 * `preview` for the editor's detached ghost note.
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

    constructor(note: Note, context: { line: number; width: NoteWidth }) {
        const { line, width } = context
        this.width = width
        this.noteY = Staff.yForNoteLine(line)
        this.glyphName = width.headGlyph
        const hasStem = !!note.pitch && note.duration.type !== 'w'

        this.noteX = width.noteX
        this.noteRightX = width.noteX + width.noteHeadWidth

        // accidental (key- and measure-aware: shown only when the alteration isn't already in effect)
        const { accidentalGlyph, accidentalX } = width
        if (accidentalGlyph && accidentalX !== undefined) this.accidental = { x: accidentalX, y: this.noteY, glyphName: accidentalGlyph }

        // ledgerLines
        const ledgerLinePositions: number[] = []
        if (note.pitch) {
            for (let l = STAFF_BOTTOM_LINE - 1; l >= line; l--) ledgerLinePositions.push(Staff.yForNoteLine(l))
            for (let l = STAFF_TOP_LINE + 1; l <= line; l++) ledgerLinePositions.push(Staff.yForNoteLine(l))
        }
        const ledgerX1 = this.noteX - LEDGER_LINE_EXTENSION
        this.ledgerLines = ledgerLinePositions.map((ly) => ({
            x1: ledgerX1,
            y1: ly,
            x2: ledgerX1 + width.noteHeadWidth + 2 * LEDGER_LINE_EXTENSION,
            y2: ly,
        }))

        // stem, and the flag at its tip
        if (hasStem) {
            const stemDir = Note.stemDirectionFor(line)
            this.stem = this.getStem(stemDir)
            const flagName = note.duration.flagGlyph(stemDir)
            if (flagName) this.flag = { glyphName: flagName, x: this.stem.x, y: this.stem.y2, scale: NoteLayout.flagScale(note.duration) }
        }

        // dots — lifted half a space when the note sits on a line (integer line), so they stay in a space
        if (width.dotXs.length > 0) {
            const dotY = Number.isInteger(line) ? this.noteY - STAVE_LINE_DISTANCE / 2 : this.noteY
            this.dots = width.dotXs.map((x) => ({ x, y: dotY }))
        }
    }

    /** The flag's glyph scale: dotted notes draw a smaller flag so it clears the dot; undefined = the default scale. */
    static flagScale(duration: Duration): number | undefined {
        return duration.dots > 0 ? DOTTED_FLAG_SCALE : undefined
    }

    /**
     * A standalone layout for a note outside the score — the editor's ghost note,
     * previewing a pitch under `clef`. It draws no accidental: with no bar around
     * it, there is no context to resolve one in.
     */
    static preview(note: Note, clef: Clef): NoteLayout {
        return new NoteLayout(note, {
            line: note.pitch ? clef.lineFor(note.pitch) : note.duration.restLine,
            width: new NoteWidth(note, undefined),
        })
    }

    getStem(stemDir: StemDirection): LayoutStem {
        return stemDir === 'up'
            ? { x: this.noteRightX - STEM_WIDTH / 2, y1: this.noteY, y2: this.noteY - STEM_HEIGHT }
            : { x: this.noteX + STEM_WIDTH / 2, y1: this.noteY, y2: this.noteY + STEM_HEIGHT }
    }
}
