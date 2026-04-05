import { getGlyphWidth, getLedgerLinePositions, getYForNote } from '@/components/notation'
import { DOT_NOTEHEAD_OFFSET, DOT_SPACING, LEDGER_LINE_EXTENSION, STAVE_LINE_DISTANCE, STEM_HEIGHT, STEM_WIDTH } from '@/components/notation/constants'

import type { Note } from '../Note'

const NOTEHEAD_WIDTH = getGlyphWidth('noteheadBlack')

export class NoteLayout {
    readonly id = crypto.randomUUID()
    constructor(private note: Note) {}

    get x() {
        return this.note.measure.layout.getX(this.note.beatOffset)
    }

    get y() {
        return getYForNote(this.note.pitch ? this.note.pitch.line : this.note.duration.restLine)
    }

    get glyphName() {
        return !this.note.pitch ? this.note.duration.restGlyph : this.note.duration.noteheadGlyph
    }

    /** Whether this note renders a stem (pitched notes except whole notes) */
    private get hasStem() {
        return !!this.note.pitch && this.note.duration.type !== 'w'
    }

    /** Stem X position — no beam dependency, safe for BeamLayout to call */
    get stemX(): number | undefined {
        if (!this.hasStem) return
        return this.note.stemDir === 'up' ? this.x + NOTEHEAD_WIDTH + STEM_WIDTH * 3 / 2 : this.x + STEM_WIDTH / 2
    }

    /** Default stem tip Y without beam adjustment — safe for BeamLayout to call */
    get defaultStemTipY(): number | undefined {
        if (!this.hasStem) return
        return this.note.stemDir === 'up' ? this.y - STEM_HEIGHT : this.y + STEM_HEIGHT
    }

    get flag() {
        if (!this.hasStem) return
        if (this.note.beam) return
        const dir = this.note.stemDir
        const x = this.x
        const y = this.y
        const flagName = this.note.duration.flagGlyph(dir)
        if (!flagName) return
        return {
            glyphName: flagName,
            ...(dir === 'up' ? { x: x + NOTEHEAD_WIDTH + STEM_WIDTH * 3 / 2, y: y - STEM_HEIGHT } : { x: x + STEM_WIDTH / 2, y: y + STEM_HEIGHT }),
        }
    }

    get stem(): { x: number; y1: number; y2: number } | undefined {
        if (!this.hasStem) return
        const dir = this.note.stemDir
        const x = this.x
        const y = this.y
        const beam = this.note.beam
        const beamY = beam ? beam.layout.beamFirstY + (x - beam.layout.firstStemX) * beam.layout.slope : null
        return dir === 'up'
            ? { x: x + NOTEHEAD_WIDTH + STEM_WIDTH * 3 / 2, y1: y, y2: beamY ?? y - STEM_HEIGHT }
            : { x: x + STEM_WIDTH / 2, y1: y, y2: beamY ?? y + STEM_HEIGHT }
    }

    get ledgerLines() {
        if (!this.note.pitch) return []
        const x = this.x
        const ledgerLineYs = getLedgerLinePositions(this.note.pitch.line)
        return ledgerLineYs.map((ly) => ({
            x1: x - LEDGER_LINE_EXTENSION,
            y1: ly,
            x2: x + NOTEHEAD_WIDTH + 2 * LEDGER_LINE_EXTENSION,
            y2: ly,
        }))
    }

    get accidental() {
        if (!this.note.pitch?.accidental) return
        const accGlyph = this.note.pitch.accidentalGlyph
        if (!accGlyph) return
        return {
            x: this.x - getGlyphWidth(accGlyph) - 2,
            y: this.y,
            glyphName: accGlyph,
        }
    }

    get dots() {
        const numDots = this.note.duration.dots
        if (!numDots || numDots <= 0) return
        const noteLine = this.note.pitch ? this.note.pitch.line : this.note.duration.restLine
        const y = this.y

        const noteRightX = this.x + NOTEHEAD_WIDTH
        const dots: { x: number; y: number }[] = []

        // If the note sits on a line (integer noteLine), shift dots up by half a space
        const onLine = Number.isInteger(noteLine)
        const dotY = onLine ? y - STAVE_LINE_DISTANCE / 2 : y

        for (let i = 0; i < numDots; i++) {
            dots.push({
                x: noteRightX + DOT_NOTEHEAD_OFFSET + i * DOT_SPACING,
                y: dotY,
            })
        }
        return dots
    }
}
