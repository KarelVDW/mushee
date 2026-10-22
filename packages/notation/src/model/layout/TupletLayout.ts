import {
    TUPLET_BRACKET_HEIGHT,
    TUPLET_BRACKET_THICKNESS,
    TUPLET_NUMBER_CLEARANCE,
    TUPLET_NUMBER_SCALE,
    TUPLET_OFFSET,
} from '../../engraving/constants'
import type { Note } from '../Note'
import type { Tuplet } from '../Tuplet'
import { DigitRun } from './DigitRun'
import type { NoteLayout } from './NoteLayout'
import type { LayoutGlyph } from './types'

/** A filled rectangle of the bracket: a tick or one half of the line. */
export interface BracketRect {
    x: number
    y: number
    width: number
    height: number
}

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
    /**
     * The bracket's rects, left to right: the left tick, the line halves either side
     * of the number (a half too short to draw is left out), the right tick. Ticks point
     * toward the notes. Empty when the group is unbracketed.
     */
    readonly bracket: BracketRect[]
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

        const number = new DigitRun(tuplet.firstNote.duration.ratio.actualNotes, TUPLET_NUMBER_SCALE)
        const centreX = (this.x1 + this.x2) / 2
        this.numberGlyphs = number.centredAt(centreX, this.y)
        this.bracket = this.bracketed ? this.bracketRects(stemDir === 'up', centreX, number.width / 2 + TUPLET_NUMBER_CLEARANCE) : []
    }

    /** The bracket around a number centred on `centreX`, leaving `halfGap` clear on each side of the centre. */
    private bracketRects(above: boolean, centreX: number, halfGap: number): BracketRect[] {
        // Above the notes the ticks hang down from the line; below them they rise to it.
        const tickY = above ? this.y : this.y - TUPLET_BRACKET_HEIGHT
        const tick = (x: number) => ({ x, y: tickY, width: TUPLET_BRACKET_THICKNESS, height: TUPLET_BRACKET_HEIGHT })
        const line = (x: number, width: number) => ({ x, y: this.y, width, height: TUPLET_BRACKET_THICKNESS })
        const rects = [tick(this.x1)]
        if (centreX - halfGap > this.x1) rects.push(line(this.x1, centreX - halfGap - this.x1))
        if (this.x2 > centreX + halfGap) rects.push(line(centreX + halfGap, this.x2 - (centreX + halfGap)))
        rects.push(tick(this.x2))
        return rects
    }
}
