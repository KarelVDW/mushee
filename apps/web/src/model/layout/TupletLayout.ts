import { getGlyphWidth } from '@/components/notation'
import { TUPLET_NUMBER_SCALE, TUPLET_OFFSET } from '@/components/notation/constants'
import type { LayoutGlyph } from '@/components/notation/types'

import type { Note } from '../Note'
import type { Tuplet } from '../Tuplet'
import type { NoteLayout } from './NoteLayout'

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
    readonly numberGlyphs: Array<{ glyphName: string; x: number; y: number }>

    constructor(tuplet: Tuplet, context: { xOf: (note: Note) => number; layoutOf: (note: Note) => NoteLayout }) {
        const upCount = tuplet.notes.filter((n) => n.stemDir === 'up').length
        const stemDir = upCount >= tuplet.notes.length / 2 ? 'up' : 'down'
        const firstLayout = context.layoutOf(tuplet.firstNote)
        const lastLayout = context.layoutOf(tuplet.lastNote)
        this.x1 = context.xOf(tuplet.firstNote) + firstLayout.noteX
        this.x2 = context.xOf(tuplet.lastNote) + lastLayout.noteX + lastLayout.width.noteHeadWidth
        const stemTips = tuplet.notes.map((n) => {
            const layout = context.layoutOf(n)
            return layout.stem?.y2 ?? layout.noteY
        })
        this.y = stemDir === 'up' ? Math.min(...stemTips) - TUPLET_OFFSET : Math.max(...stemTips) + TUPLET_OFFSET
        this.bracketed = !tuplet.notes.every((n) => context.layoutOf(n).flag === undefined && n.duration.isBeamable)
        this.location = stemDir === 'up' ? 1 : -1

        const { actualNotes: numNotes } = tuplet.notes[0].duration.ratio
        const glyphNames = String(numNotes)
            .split('')
            .map((d) => `timeSig${d}`)
        const scale = TUPLET_NUMBER_SCALE
        const totalWidth = glyphNames.reduce((sum, name) => sum + getGlyphWidth(name, scale), 0)
        let x = (this.x1 + this.x2) / 2 - totalWidth / 2
        const y = this.y
        const glyphs: LayoutGlyph[] = []
        // Numerator digits
        for (const name of glyphNames) {
            glyphs.push({ glyphName: name, x, y })
            x += getGlyphWidth(name, scale)
        }
        this.numberGlyphs = glyphs
    }
}
