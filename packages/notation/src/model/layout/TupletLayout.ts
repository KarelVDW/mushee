import {
    TUPLET_BRACKET_HEIGHT,
    TUPLET_BRACKET_THICKNESS,
    TUPLET_NUMBER_CLEARANCE,
    TUPLET_NUMBER_SCALE,
    TUPLET_OFFSET,
} from '../../engraving/constants'
import type { Note } from '../Note'
import type { Tuplet } from '../Tuplet'
import type { StemDirection } from '../types'
import type { BeamLayout } from './BeamLayout'
import { DigitRun } from './DigitRun'
import type { NoteLayout } from './NoteLayout'
import type { LayoutGlyph, LayoutStem } from './types'

/** A filled rectangle of the bracket: a tick or one half of the line. */
export interface BracketRect {
    x: number
    y: number
    width: number
    height: number
}

/** What TupletLayout reads about each member note, as MeasureLayout resolved it. */
export interface TupletLayoutContext {
    xOf: (note: Note) => number
    layoutOf: (note: Note) => NoteLayout
    /** The stem the note is drawn with — its beam's, when beamed. */
    stemOf: (note: Note) => LayoutStem | undefined
    stemDirOf: (note: Note) => StemDirection
    beamOf: (note: Note) => BeamLayout | undefined
}

/**
 * The bracket and ratio number above (or below) a tuplet group. Built by
 * MeasureLayout with explicit context — each member's x, layout and
 * effective (beam-aware) stem.
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

    constructor(tuplet: Tuplet, context: TupletLayoutContext) {
        // Placed on the stem side the majority of the drawn stems point to.
        const upCount = tuplet.notes.filter((n) => context.stemDirOf(n) === 'up').length
        const stemDir = upCount >= tuplet.notes.length / 2 ? 'up' : 'down'
        const firstLayout = context.layoutOf(tuplet.firstNote)
        const lastLayout = context.layoutOf(tuplet.lastNote)
        this.x1 = context.xOf(tuplet.firstNote) + firstLayout.noteX
        this.x2 = context.xOf(tuplet.lastNote) + lastLayout.noteRightX
        // Clear of every drawn stem tip — the beam line, for beamed notes — or the notehead of a stemless note.
        const stemTips = tuplet.notes.map((n) => context.stemOf(n)?.y2 ?? context.layoutOf(n).noteY)
        this.y = stemDir === 'up' ? Math.min(...stemTips) - TUPLET_OFFSET : Math.max(...stemTips) + TUPLET_OFFSET
        // A group under one beam is already joined by it: the number alone marks the tuplet.
        const firstBeam = context.beamOf(tuplet.firstNote)
        this.bracketed = !(firstBeam !== undefined && tuplet.notes.every((n) => context.beamOf(n) === firstBeam))

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
