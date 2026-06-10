import { makeScore } from '@test/helpers'
import { describe, expect, it } from 'vitest'

import { MAX_MEASURES_PER_ROW, TIE_Y_SHIFT } from '@/components/notation/constants'
import { Duration } from '@/model/Duration'
import { Note } from '@/model/Note'
import { Pitch } from '@/model/Pitch'
import { Score } from '@/model/Score'
import type { Tie } from '@/model/Tie'

/** A pitched half-note carrying a tie type, for use as a `replace` value. */
function halfNote(name: string, octave: number, tie?: 'start' | 'stop'): Note {
    return new Note({ duration: new Duration({ type: 'h' }), pitch: new Pitch({ name, octave }), tie })
}

/**
 * Replace the first measure's rests with two pitched half-notes, the first tied to the second,
 * and return the resulting Tie. Both notes land in the same row.
 */
function sameRowTie(name = 'C', octave = 4): { score: Score; tie: Tie } {
    const score = makeScore(1)
    const m = score.firstMeasure
    if (!m) throw new Error('expected first measure')
    const target = m.firstNote
    if (!target) throw new Error('expected first note')
    score.replace([target], [halfNote(name, octave, 'start'), halfNote(name, octave, 'stop')])
    const tie = score.getTieByNote(m.notes[0])
    if (!tie) throw new Error('expected a tie')
    return { score, tie }
}

/**
 * Tie the last note of the measure that ends row 0 forward into the first note of row 1,
 * producing a tie whose endpoints sit on different rows.
 */
function crossRowTie(): { score: Score; tie: Tie } {
    const score = makeScore(MAX_MEASURES_PER_ROW + 1) // index MAX-1 ends row 0, index MAX starts row 1
    const rowEndMeasure = score.measures[MAX_MEASURES_PER_ROW - 1]
    const lastNote = rowEndMeasure.lastNote
    if (!lastNote) throw new Error('expected last note of row-ending measure')
    const [tieStart] = score.replace([lastNote], [new Note({ duration: new Duration({ type: 'q' }), pitch: new Pitch({ name: 'C', octave: 5 }), tie: 'start' })])
    const tie = score.getTieByNote(tieStart)
    if (!tie) throw new Error('expected a cross-row tie')
    return { score, tie }
}

describe('TieLayout', () => {
    it('draws a single segment in the start row when both notes share a row', () => {
        const { tie } = sameRowTie()
        expect(tie.layout.segments).toHaveLength(1)
        const seg = tie.layout.segments[0]
        expect(seg.rowIndex).toBe(0)
        // A single curve runs left-to-right within one measure group.
        expect(seg.endX).toBeGreaterThan(seg.startX)
    })

    it('shifts both endpoints by TIE_Y_SHIFT in the tie direction', () => {
        const { tie } = sameRowTie()
        const seg = tie.layout.segments[0]
        expect(seg.startY).toBe(tie.note.layout.noteY + TIE_Y_SHIFT * tie.layout.direction)
        expect(seg.endY).toBe(tie.nextNote.layout.noteY + TIE_Y_SHIFT * tie.layout.direction)
    })

    it('curves upward (direction 1) for a stem-up note', () => {
        // C4 is at line 0 (< 3) → stem up → direction 1.
        const { tie } = sameRowTie('C', 4)
        expect(tie.note.stemDir).toBe('up')
        expect(tie.layout.direction).toBe(1)
    })

    it('curves downward (direction -1) for a stem-down note', () => {
        // A5 sits high (>= line 3) → stem down → direction -1.
        const { tie } = sameRowTie('A', 5)
        expect(tie.note.stemDir).toBe('down')
        expect(tie.layout.direction).toBe(-1)
    })

    it('follows the beam stem direction when the start note is beamed', () => {
        // Two eighth notes in a beat beam together; the beam's stemDir drives the tie direction.
        const score = makeScore(1)
        const m = score.firstMeasure
        if (!m) throw new Error('expected first measure')
        const target = m.firstNote
        if (!target) throw new Error('expected first note')
        const eighth = (tie?: 'start' | 'stop') =>
            new Note({ duration: new Duration({ type: '8' }), pitch: new Pitch({ name: 'C', octave: 4 }), tie })
        score.replace([target], [eighth('start'), eighth('stop')])
        const start = m.notes[0]
        const beam = m.beamOf(start)
        if (!beam) throw new Error('expected a beam')
        const tie = score.getTieByNote(start)
        if (!tie) throw new Error('expected a tie')
        expect(tie.layout.direction).toBe(beam.stemDir === 'up' ? 1 : -1)
    })

    it('splits into two row-local segments when the notes are on different rows', () => {
        const { tie } = crossRowTie()
        expect(tie.layout.segments).toHaveLength(2)
        const [seg0, seg1] = tie.layout.segments
        const startRow = tie.note.measure.score.getRowForMeasure(tie.note.measure)
        const endRow = tie.nextNote.measure.score.getRowForMeasure(tie.nextNote.measure)
        expect(seg0.rowIndex).toBe(startRow.index)
        expect(seg1.rowIndex).toBe(endRow.index)
        expect(seg0.rowIndex).not.toBe(seg1.rowIndex)
        // Each segment stays level on its own row (start/end Y equal within the segment).
        expect(seg0.endY).toBe(seg0.startY)
        expect(seg1.startY).toBe(seg1.endY)
    })

    it('first segment ends at the row edge and the second begins before its measure', () => {
        const { tie } = crossRowTie()
        const startMeasure = tie.note.measure
        const startRow = startMeasure.score.getRowForMeasure(startMeasure)
        const endMeasure = tie.nextNote.measure
        const endRow = endMeasure.score.getRowForMeasure(endMeasure)
        const endMeasureX = endRow.layout.getMeasureX(endMeasure)
        const startMeasureX = startRow.layout.getMeasureX(startMeasure)
        const [seg0, seg1] = tie.layout.segments
        // Seg 0 ends at the right edge of the start row, expressed measure-local.
        expect(seg0.endX).toBe(startRow.layout.width - startMeasureX)
        // Seg 1 begins to the left of its own measure origin (negative, measure-local).
        expect(seg1.startX).toBe(-endMeasureX)
    })
})
