import { makeScore } from '@test/helpers'
import { describe, expect, it } from 'vitest'

import { MAX_MEASURES_PER_ROW, TIE_Y_SHIFT } from '@/components/notation/constants'
import { Duration } from '@/model/Duration'
import type { TieLayout } from '@/model/layout/TieLayout'
import { Note } from '@/model/Note'
import { Pitch } from '@/model/Pitch'
import { Score } from '@/model/Score'

/** A pitched half-note carrying a tie type, for use as a `replace` value. */
function halfNote(name: string, octave: number, tie?: 'start' | 'stop'): Note {
    return new Note({ duration: new Duration({ type: 'h' }), pitch: new Pitch({ name, octave }), tie })
}

/** The TieLayout starting at `note`, from the score's current layout snapshot. */
function tieStartingAt(score: Score, note: Note): TieLayout {
    const tie = score.layout.ties.find((t) => t.note === note)
    if (!tie) throw new Error('expected a tie layout starting at the note')
    return tie
}

/**
 * Replace the first measure's rests with two pitched half-notes, the first tied to the second,
 * and return the resulting TieLayout. Both notes land in the same row.
 */
function sameRowTie(name = 'C', octave = 4): { score: Score; tie: TieLayout } {
    const score = makeScore(1)
    const m = score.firstMeasure
    if (!m) throw new Error('expected first measure')
    const target = m.firstNote
    if (!target) throw new Error('expected first note')
    score.replace([target], [halfNote(name, octave, 'start'), halfNote(name, octave, 'stop')])
    return { score, tie: tieStartingAt(score, m.notes[0]) }
}

/**
 * Tie the last note of the measure that ends row 0 forward into the first note of row 1,
 * producing a tie whose endpoints sit on different rows.
 */
function crossRowTie(): { score: Score; tie: TieLayout } {
    const score = makeScore(MAX_MEASURES_PER_ROW + 1) // index MAX-1 ends row 0, index MAX starts row 1
    const rowEndMeasure = score.measures[MAX_MEASURES_PER_ROW - 1]
    const lastNote = rowEndMeasure.lastNote
    if (!lastNote) throw new Error('expected last note of row-ending measure')
    const [tieStart] = score.replace(
        [lastNote],
        [new Note({ duration: new Duration({ type: 'q' }), pitch: new Pitch({ name: 'C', octave: 5 }), tie: 'start' })],
    )
    return { score, tie: tieStartingAt(score, tieStart) }
}

describe('TieLayout', () => {
    it('draws a single segment in the start row when both notes share a row', () => {
        const { tie } = sameRowTie()
        expect(tie.segments).toHaveLength(1)
        const seg = tie.segments[0]
        expect(seg.rowIndex).toBe(0)
        // A single curve runs left-to-right within the row.
        expect(seg.endX).toBeGreaterThan(seg.startX)
    })

    it('shifts both endpoints by TIE_Y_SHIFT in the tie direction', () => {
        const { tie } = sameRowTie()
        const seg = tie.segments[0]
        expect(seg.startY).toBe(tie.note.layout.noteY + TIE_Y_SHIFT * tie.direction)
        expect(seg.endY).toBe(tie.nextNote.layout.noteY + TIE_Y_SHIFT * tie.direction)
    })

    it('curves upward (direction 1) for a stem-up note', () => {
        // C4 is at line 0 (< 3) → stem up → direction 1.
        const { tie } = sameRowTie('C', 4)
        expect(tie.note.stemDir).toBe('up')
        expect(tie.direction).toBe(1)
    })

    it('curves downward (direction -1) for a stem-down note', () => {
        // A5 sits high (>= line 3) → stem down → direction -1.
        const { tie } = sameRowTie('A', 5)
        expect(tie.note.stemDir).toBe('down')
        expect(tie.direction).toBe(-1)
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
        const beam = m.layout.beamFor(start)
        if (!beam) throw new Error('expected a beam')
        const tie = tieStartingAt(score, start)
        expect(tie.direction).toBe(beam.stemDir === 'up' ? 1 : -1)
    })

    it('splits into two row-local segments when the notes are on different rows', () => {
        const { score, tie } = crossRowTie()
        expect(tie.segments).toHaveLength(2)
        const [seg0, seg1] = tie.segments
        const startRow = score.layout.rowFor(tie.note.measure)
        const endRow = score.layout.rowFor(tie.nextNote.measure)
        expect(seg0.rowIndex).toBe(startRow.index)
        expect(seg1.rowIndex).toBe(endRow.index)
        expect(seg0.rowIndex).not.toBe(seg1.rowIndex)
        // Each segment stays level on its own row (start/end Y equal within the segment).
        expect(seg0.endY).toBe(seg0.startY)
        expect(seg1.startY).toBe(seg1.endY)
    })

    it('first segment runs to the row edge and the second begins at the next row origin (row-local)', () => {
        const { score, tie } = crossRowTie()
        const startRow = score.layout.rowFor(tie.note.measure)
        const [seg0, seg1] = tie.segments
        // Seg 0 ends at the right edge of the start row.
        expect(seg0.endX).toBe(startRow.width)
        // Seg 1 begins at the end row's left edge (x = 0, row-local).
        expect(seg1.startX).toBe(0)
        // And reaches the tied-into note inside its measure.
        const endRow = score.layout.rowFor(tie.nextNote.measure)
        const endMeasureLayout = score.layout.measureLayoutFor(tie.nextNote.measure)
        const expectedEndX =
            endRow.getMeasureX(tie.nextNote.measure) + endMeasureLayout.getXForElement(tie.nextNote) + tie.nextNote.layout.noteX
        expect(seg1.endX).toBeCloseTo(expectedEndX)
    })

    it('reuses the tie layout instance when nothing relevant changed, and rebuilds it when geometry moves', () => {
        // Two full rows: the tie sits in row 0; mutations in row 1 must not rebuild it.
        const score = makeScore(MAX_MEASURES_PER_ROW + 1)
        const m = score.firstMeasure
        if (!m) throw new Error('expected first measure')
        const target = m.firstNote
        if (!target) throw new Error('expected first note')
        score.replace([target], [halfNote('C', 4, 'start'), halfNote('C', 4, 'stop')])
        const before = tieStartingAt(score, m.notes[0])
        // Same snapshot → same instance.
        expect(tieStartingAt(score, before.note)).toBe(before)
        // Mutate a measure on the OTHER row — row 0's packing and the tie geometry are unchanged → reused.
        const lastMeasure = score.lastMeasure
        const farNote = lastMeasure?.firstNote
        if (!farNote) throw new Error('expected a note in the last measure')
        score.setTempo(farNote, 77)
        const after = tieStartingAt(score, before.note)
        expect(after.contextSignature).toBe(before.contextSignature)
        expect(after).toBe(before)
        // Mutate the tie's own measure (pitch change shifts the note Y) → new instance.
        const [newStart] = score.replace([before.note], [halfNote('G', 5, 'start')])
        const rebuilt = tieStartingAt(score, newStart)
        expect(rebuilt).not.toBe(before)
    })
})
