import { MAX_MEASURES_PER_ROW, TIE_Y_SHIFT } from '@mushee/notation/engraving/constants'
import { Duration } from '@mushee/notation/model/Duration'
import type { TieLayout } from '@mushee/notation/model/layout/TieLayout'
import { Note } from '@mushee/notation/model/Note'
import { Pitch, type PitchStep } from '@mushee/notation/model/Pitch'
import type { Score } from '@mushee/notation/model/Score'
import { makeScore } from '@mushee/notation/testing'
import { describe, expect, it } from 'vitest'

/** A pitched half-note carrying a tie type, for use as a `replace` value. */
function halfNote(name: PitchStep, octave: number, tie?: 'start' | 'stop'): Note {
    return new Note({ duration: new Duration({ type: 'h' }), pitch: new Pitch({ name, octave }), tie })
}

/** The TieLayout starting at `note`, from the score's current layout snapshot. */
function tieStartingAt(score: Score, note: Note): TieLayout {
    const tie = score.layout.ties.find((t) => t.note === note)
    if (!tie) throw new Error('expected a tie layout starting at the note')
    return tie
}

/** The note `tie` runs into — the score's semantic pairing, which the layout does not carry. */
function endNoteOf(score: Score, tie: TieLayout): Note {
    const end = score.tiePartner(tie.note)
    if (!end) throw new Error('expected the tie to have an end note')
    return end
}

/**
 * Replace the first measure's rests with two pitched half-notes, the first tied to the second,
 * and return the resulting TieLayout. Both notes land in the same row.
 */
function sameRowTie(name: PitchStep = 'C', octave = 4): { score: Score; tie: TieLayout } {
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
    const nextRowMeasure = score.measures[MAX_MEASURES_PER_ROW]
    const [tieStart] = score.replace(
        [lastNote, nextRowMeasure.notes[0]],
        [
            new Note({ duration: new Duration({ type: 'q' }), pitch: new Pitch({ name: 'C', octave: 5 }), tie: 'start' }),
            new Note({ duration: new Duration({ type: 'q' }), pitch: new Pitch({ name: 'C', octave: 5 }) }),
        ],
    )
    return { score, tie: tieStartingAt(score, tieStart) }
}

describe('TieLayout', () => {
    it('leaves a whole note from its whole notehead’s right edge', () => {
        const score = makeScore(2)
        const [m0, m1] = score.measures
        const whole = (tie?: 'start') =>
            new Note({ duration: new Duration({ type: 'w' }), pitch: new Pitch({ name: 'C', octave: 4 }), tie })
        const [start] = score.replace(m0.notes, [whole('start')])
        score.replace(m1.notes, [whole()])
        const seg = tieStartingAt(score, start).segments[0]
        const row = score.layout.rowFor(m0)
        // Mock widths: noteheadWhole 14 (a black notehead would be 10).
        expect(start.layout.noteRightX).toBe(start.layout.noteX + 14)
        expect(seg.startX).toBeCloseTo(row.getMeasureX(m0) + m0.layout.getXForElement(start) + start.layout.noteX + 14)
    })

    it('draws a single segment in the start row when both notes share a row', () => {
        const { tie } = sameRowTie()
        expect(tie.segments).toHaveLength(1)
        const seg = tie.segments[0]
        expect(seg.rowIndex).toBe(0)
        // A single curve runs left-to-right within the row.
        expect(seg.endX).toBeGreaterThan(seg.startX)
    })

    it('shifts both endpoints by TIE_Y_SHIFT in the tie direction', () => {
        const { score, tie } = sameRowTie()
        const seg = tie.segments[0]
        expect(seg.startY).toBe(tie.note.layout.noteY + TIE_Y_SHIFT * tie.direction)
        expect(seg.endY).toBe(endNoteOf(score, tie).layout.noteY + TIE_Y_SHIFT * tie.direction)
    })

    it('bends below the notes (direction 1) for stem-up notes', () => {
        // C4 is at line 0 (< 3) → stem up → direction 1.
        const { tie } = sameRowTie('C', 4)
        expect(tie.note.stemDir).toBe('up')
        expect(tie.direction).toBe(1)
    })

    it('bends above the notes (direction −1) for stem-down notes', () => {
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
        const endRow = score.layout.rowFor(endNoteOf(score, tie).measure)
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
        const end = endNoteOf(score, tie)
        const endRow = score.layout.rowFor(end.measure)
        const endMeasureLayout = score.layout.measureLayoutFor(end.measure)
        const expectedEndX = endRow.getMeasureX(end.measure) + endMeasureLayout.getXForElement(end) + end.layout.noteX
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
        const [newStart] = score.replace([before.note, m.notes[1]], [halfNote('G', 5, 'start'), halfNote('G', 5, 'stop')])
        const rebuilt = tieStartingAt(score, newStart)
        expect(rebuilt).not.toBe(before)
    })
})
