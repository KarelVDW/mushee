import { getGlyphWidth } from '@/components/notation'
import { TUPLET_NUMBER_SCALE, TUPLET_OFFSET } from '@/components/notation/constants'
import type { LayoutGlyph } from '@/components/notation/types'

import type { Tuplet } from '../Tuplet'

const NOTEHEAD_WIDTH = getGlyphWidth('noteheadBlack')

export class TupletLayout {
    private stemDir: 'up' | 'down'
    constructor(private tuplet: Tuplet) {
        const upCount = this.tuplet.notes.filter((n) => n.stemDir === 'up').length
        this.stemDir = upCount >= this.tuplet.notes.length / 2 ? 'up' : 'down'
    }

    get x1() {
        return this.tuplet.firstNote.layout.x
    }

    get x2() {
        return this.tuplet.lastNote.layout.x + NOTEHEAD_WIDTH
    }

    get y() {
        let y: number
        if (this.stemDir === 'up') {
            // Bracket above: find the highest stem tip (lowest Y)
            const stemTips = this.tuplet.notes.map((n) => n.layout.stem?.y2 ?? n.layout.y)
            y = Math.min(...stemTips) - TUPLET_OFFSET
        } else {
            // Bracket below: find the lowest stem tip (highest Y)
            const stemTips = this.tuplet.notes.map((n) => n.layout.stem?.y2 ?? n.layout.y)
            y = Math.max(...stemTips) + TUPLET_OFFSET
        }
        return y
    }

    get bracketed() {
        return !this.tuplet.notes.every((n) => n.layout.flag === undefined && n.duration.isBeamable)
    }

    get location(): 1 | -1 {
        return this.stemDir === 'up' ? 1 : -1
    }

    get numberGlyphs() {
        const showRatio = false

        const centerX = (this.x1 + this.x2) / 2

        const { normalNotes: notesOccupied, actualNotes: numNotes } = this.tuplet.notes[0].duration.ratio

        const digits = String(numNotes).split('')
        const glyphs: LayoutGlyph[] = []

        // Calculate total width of all glyphs to center them
        const glyphNames = digits.map((d) => `timeSig${d}`)

        let ratioGlyphNames: string[] = []
        if (showRatio) {
            const denomDigits = String(notesOccupied).split('')
            ratioGlyphNames = denomDigits.map((d) => `timeSig${d}`)
        }

        // Total width at tuplet scale
        const scale = TUPLET_NUMBER_SCALE
        let totalWidth = glyphNames.reduce((sum, name) => sum + getGlyphWidth(name, scale), 0)
        if (showRatio && ratioGlyphNames.length > 0) {
            totalWidth += 4 // colon spacing
            totalWidth += ratioGlyphNames.reduce((sum, name) => sum + getGlyphWidth(name, scale), 0)
        }

        let x = centerX - totalWidth / 2
        const y = this.y

        // Numerator digits
        for (const name of glyphNames) {
            glyphs.push({ glyphName: name, x, y })
            x += getGlyphWidth(name, scale)
        }

        // Ratio ":N" if requested
        if (showRatio && ratioGlyphNames.length > 0) {
            x += 4 // colon spacing
            for (const name of ratioGlyphNames) {
                glyphs.push({ glyphName: name, x, y })
                x += getGlyphWidth(name, scale)
            }
        }

        return glyphs
    }
}
