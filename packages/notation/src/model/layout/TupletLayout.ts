import { TUPLET_NUMBER_SCALE, TUPLET_OFFSET } from '../../engraving/constants'
import type { Note } from '../Note'
import type { Tuplet } from '../Tuplet'
import { DigitRun } from './DigitRun'
import type { NoteLayout } from './NoteLayout'
import type { LayoutGlyph } from './types'

/**
 * The bracket and ratio number above (or below) a tuplet group. Built by
 * MeasureLayout with explicit context — the x position and layout of each
 * member note.
 */
export class TupletLayout {
    readonly id = crypto.randomUUID()
    readonly x1: number
    readonly x2: number
    readonly y: number
    readonly bracketed: boolean
    readonly location: 1 | -1
    readonly numberGlyphs: LayoutGlyph[]

    constructor(tuplet: Tuplet, context: { xOf: (note: Note) => number; layoutOf: (note: Note) => NoteLayout }) {
        const upCount = tuplet.notes.filter((n) => n.stemDir === 'up').length
        const stemDir = upCount >= tuplet.notes.length / 2 ? 'up' : 'down'
        const firstLayout = context.layoutOf(tuplet.firstNote)
        const lastLayout = context.layoutOf(tuplet.lastNote)
        this.x1 = context.xOf(tuplet.firstNote) + firstLayout.noteX
        this.x2 = context.xOf(tuplet.lastNote) + lastLayout.noteRightX
        const stemTips = tuplet.notes.map((n) => {
            const layout = context.layoutOf(n)
            return layout.stem?.y2 ?? layout.noteY
        })
        this.y = stemDir === 'up' ? Math.min(...stemTips) - TUPLET_OFFSET : Math.max(...stemTips) + TUPLET_OFFSET
        this.bracketed = !tuplet.notes.every((n) => context.layoutOf(n).flag === undefined && n.duration.isBeamable)
        this.location = stemDir === 'up' ? 1 : -1

        this.numberGlyphs = new DigitRun(tuplet.firstNote.duration.ratio.actualNotes, TUPLET_NUMBER_SCALE).centredAt(
            (this.x1 + this.x2) / 2,
            this.y,
        )
    }
}
