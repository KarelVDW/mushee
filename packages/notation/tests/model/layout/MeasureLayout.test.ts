import {
    BARLINE_GAP,
    BARLINE_THICK_WIDTH,
    BARLINE_THIN_WIDTH,
    NUM_STAFF_LINES,
    SPACE_ABOVE_STAFF,
    STAVE_LINE_DISTANCE,
} from '@mushee/notation/components/constants'
import { Duration } from '@mushee/notation/model/Duration'
import type { KeySignature } from '@mushee/notation/model/KeySignature'
import { MeasureLayout, type MeasureLayoutContext } from '@mushee/notation/model/layout/MeasureLayout'
import { Measure } from '@mushee/notation/model/Measure'
import { Note } from '@mushee/notation/model/Note'
import { Pitch } from '@mushee/notation/model/Pitch'
import { Score } from '@mushee/notation/model/Score'
import { TimeSignature } from '@mushee/notation/model/TimeSignature'
import { KeySignatureWidth } from '@mushee/notation/model/width/KeySignatureWidth'
import type { NoteWidth } from '@mushee/notation/model/width/NoteWidth'
import { makeScore, pitched, rest } from '@mushee/notation/testing'
import { describe, expect, it } from 'vitest'

/** A registered measure inside a fresh score (no notes unless added). */
function registeredMeasure(): { score: Score; m: Measure } {
    const score = new Score()
    return { score, m: score.addMeasure() }
}

function tripletEighth(): Note {
    return new Note({
        duration: new Duration({ type: '8', ratio: { actualNotes: 3, normalNotes: 2 } }),
        pitch: new Pitch({ name: 'C', octave: 4 }),
    })
}

describe('MeasureLayout', () => {
    it('builds a layout for a default 4/4 measure with rests', () => {
        const score = makeScore(1)
        const m = score.firstMeasure
        if (!m) throw new Error('expected firstMeasure')
        expect(m.layout.measureX).toBe(0)
        expect(m.layout.measureWidth).toBeGreaterThan(0)
        expect(m.layout.rowIndex).toBe(0)
    })

    it('positions notes left to right in measure-relative coordinates', () => {
        const { m } = registeredMeasure()
        m.addNotes([rest('q'), rest('q'), rest('q'), rest('q')])
        const layout = m.layout
        const xs = m.notes.map((n) => layout.getXForElement(n))
        for (let i = 1; i < xs.length; i++) expect(xs[i]).toBeGreaterThan(xs[i - 1])
    })

    it('throws "Element not spaced in measure" for unknown elements', () => {
        const score = makeScore(1)
        const m = score.firstMeasure
        if (!m) throw new Error('expected firstMeasure')
        expect(() => m.layout.getXForElement(rest('q'))).toThrow('Element not spaced in measure')
    })

    describe('leading elements', () => {
        it('places clef, drawn key signature, and time signature in order at the measure start', () => {
            const score = makeScore(1)
            const m = score.firstMeasure
            if (!m) throw new Error('expected firstMeasure')
            score.setKeySignature(m.firstNote, 2)
            const layout = m.layout
            const keyWidth = new KeySignatureWidth(m.keySignature.drawnAccidentals).total
            expect(layout.getXForElement(m.clef)).toBe(0)
            expect(layout.getXForElement(m.keySignature)).toBe(m.clef.width.total)
            expect(layout.getXForElement(m.timeSignature)).toBe(m.clef.width.total + keyWidth)
        })

        it('skips a C-major key signature even when the shows-flag is set', () => {
            const score = makeScore(1)
            const m = score.firstMeasure
            if (!m) throw new Error('expected firstMeasure')
            expect(m.layout.showsKeySignature).toBe(true)
            expect(m.keySignature.drawnAccidentals).toHaveLength(0)
            // Nothing is drawn, so the key occupies no slot.
            expect(() => m.layout.getXForElement(m.keySignature)).toThrow('Element not spaced in measure')
            // The time signature follows the clef directly.
            expect(m.layout.getXForElement(m.timeSignature)).toBe(m.clef.width.total)
        })

        it('omits clef and time signature for a mid-row measure with unchanged context', () => {
            const score = makeScore(2)
            const m = score.measures[1]
            expect(() => m.layout.getXForElement(m.clef)).toThrow('Element not spaced in measure')
            expect(() => m.layout.getXForElement(m.timeSignature)).toThrow('Element not spaced in measure')
        })
    })

    describe('getNoteForX', () => {
        it('returns the note whose allotted range contains x, or null outside any range', () => {
            const score = makeScore(1)
            const m = score.firstMeasure
            if (!m) throw new Error('expected firstMeasure')
            const firstNote = m.firstNote
            if (!firstNote) throw new Error('expected firstNote')
            expect(m.layout.getNoteForX(m.layout.getXForElement(firstNote))).toBe(firstNote)
            expect(m.layout.getNoteForX(-1)).toBeNull()
            expect(m.layout.getNoteForX(99999)).toBeNull()
        })
    })

    describe('getAllottedWidth', () => {
        it("returns each note's slot width, with the last note's slot reaching the end barline", () => {
            const { m } = registeredMeasure()
            m.addNotes([rest('q'), rest('q'), rest('q'), rest('q')])
            const layout = m.layout
            const lastNote = m.notes.at(-1)
            if (!lastNote) throw new Error('expected lastNote')
            // Slots are contiguous: each note's slot ends where the next begins.
            for (let i = 1; i < m.notes.length; i++) {
                expect(layout.getXForElement(m.notes[i - 1]) + layout.getAllottedWidth(m.notes[i - 1])).toBeCloseTo(
                    layout.getXForElement(m.notes[i]),
                )
            }
            // The final slot runs all the way to the end barline.
            const slotEnd = layout.getXForElement(lastNote) + layout.getAllottedWidth(lastNote)
            expect(slotEnd).toBeCloseTo(layout.measureWidth - MeasureLayout.barlineWidth(m.endBarline))
        })

        it('throws "Element not spaced in measure" for unknown elements', () => {
            const score = makeScore(1)
            const m = score.firstMeasure
            if (!m) throw new Error('expected firstMeasure')
            expect(() => m.layout.getAllottedWidth(rest('q'))).toThrow('Element not spaced in measure')
        })
    })

    describe('getXForBeat', () => {
        it('is monotonically non-decreasing across the measure', () => {
            const score = makeScore(1)
            const m = score.firstMeasure
            if (!m) throw new Error('expected firstMeasure')
            let prev = -Infinity
            for (let beat = 0; beat <= m.maxBeats; beat += 0.25) {
                const x = m.layout.getXForBeat(beat)
                expect(x).toBeGreaterThanOrEqual(prev - 0.0001)
                prev = x
            }
        })

        it('returns 0 for a measure with no notes', () => {
            const { m } = registeredMeasure()
            expect(m.notes).toHaveLength(0)
            expect(m.layout.getXForBeat(0)).toBe(0)
        })

        it('interpolates linearly within the note containing the beat', () => {
            const { m } = registeredMeasure()
            m.addNotes([pitched('C', 4, 'h'), pitched('E', 4, 'h')])
            const layout = m.layout
            const second = m.notes[1]
            const x2 = layout.getXForElement(second)
            expect(layout.getXForBeat(2)).toBeCloseTo(x2)
            // Beat 3 is halfway through the second half note (beats 2-4).
            const width2 = layout.getXForBeat(4) - x2 // beat 4 = end of the note's allotted span
            expect(layout.getXForBeat(3)).toBeCloseTo(x2 + width2 / 2)
        })

        it('clamps a beat past the last note onto the last note', () => {
            const { m } = registeredMeasure()
            m.addNotes([pitched('C', 4, 'h'), pitched('E', 4, 'h')])
            const layout = m.layout
            // Beat 5 overshoots every note → anchored to the last note, interpolating past it.
            expect(layout.getXForBeat(5)).toBeGreaterThan(layout.getXForBeat(4))
        })

        it('falls back to the first note for a beat before the measure start', () => {
            const score = makeScore(1)
            const m = score.firstMeasure
            if (!m) throw new Error('expected firstMeasure')
            const firstNote = m.firstNote
            if (!firstNote) throw new Error('expected firstNote')
            const x = m.layout.getXForBeat(-1)
            expect(x).toBeLessThan(m.layout.getXForElement(firstNote))
            expect(Number.isFinite(x)).toBe(true)
        })
    })

    describe('barline', () => {
        it('spans the staff at the right edge for the default single barline', () => {
            const score = makeScore(2)
            const m = score.measures[0] // 'single' end barline
            const bar = m.layout.barline
            if (!bar) throw new Error('expected barline')
            expect(bar.type).toBe('single')
            expect(bar.x).toBeCloseTo(m.layout.measureWidth - BARLINE_THIN_WIDTH)
            expect(bar.y).toBe(SPACE_ABOVE_STAFF * STAVE_LINE_DISTANCE)
            expect(bar.height).toBe((NUM_STAFF_LINES - 1) * STAVE_LINE_DISTANCE)
        })

        it('returns null when endBarline is "none"', () => {
            const score = makeScore(1)
            const m = score.firstMeasure
            if (!m) throw new Error('expected firstMeasure')
            m.setEndBarline('none')
            expect(m.layout.barline).toBeNull()
        })

        it('falls back to a single barline when endBarline is undefined', () => {
            const score = makeScore(1)
            const m = score.firstMeasure
            if (!m) throw new Error('expected firstMeasure')
            m.setEndBarline(undefined)
            const bar = m.layout.barline
            if (!bar) throw new Error('expected barline')
            expect(bar.type).toBe('single')
        })

        it('uses an explicitly set barline type and reserves its width', () => {
            const score = makeScore(1)
            const m = score.firstMeasure
            if (!m) throw new Error('expected firstMeasure')
            m.setEndBarline('double')
            const bar = m.layout.barline
            if (!bar) throw new Error('expected barline')
            expect(bar.type).toBe('double')
            expect(bar.x).toBeCloseTo(m.layout.measureWidth - MeasureLayout.barlineWidth('double'))
        })
    })

    describe('barlineWidth', () => {
        it('maps each barline type to its drawn width', () => {
            expect(MeasureLayout.barlineWidth('none')).toBe(0)
            expect(MeasureLayout.barlineWidth('single')).toBe(BARLINE_THIN_WIDTH)
            expect(MeasureLayout.barlineWidth('double')).toBe(BARLINE_THIN_WIDTH + BARLINE_GAP + BARLINE_THIN_WIDTH)
            expect(MeasureLayout.barlineWidth('end')).toBe(BARLINE_THIN_WIDTH + BARLINE_GAP + BARLINE_THICK_WIDTH)
            expect(MeasureLayout.barlineWidth(undefined)).toBe(BARLINE_THIN_WIDTH)
        })
    })

    describe('mid-measure elements', () => {
        it('folds a mid-measure key change in just before the note at its beat', () => {
            const { m } = registeredMeasure()
            m.addNotes([pitched('C', 4, 'h'), pitched('E', 4, 'h')])
            m.setKeySignature(2, 2)
            const midKey = m.keyAtBeat(2)
            if (!midKey) throw new Error('expected a mid-measure key signature')
            const layout = m.layout
            expect(layout.getXForElement(midKey)).toBeGreaterThan(layout.getXForElement(m.notes[0]))
            expect(layout.getXForElement(midKey)).toBeLessThanOrEqual(layout.getXForElement(m.notes[1]))
        })

        it('places a mid-measure clef directly before the note that shares its beat', () => {
            const { m } = registeredMeasure()
            m.addNotes([pitched('C', 4, 'q'), pitched('D', 4, 'q'), pitched('E', 4, 'q'), pitched('F', 4, 'q')])
            m.setClef(2, 'bass')
            const midClef = m.clefAtBeat(2)
            if (!midClef) throw new Error('expected a mid-measure clef')
            const layout = m.layout
            expect(layout.getXForElement(midClef)).toBeGreaterThan(layout.getXForElement(m.notes[0]))
            expect(layout.getXForElement(m.notes[2])).toBeCloseTo(layout.getXForElement(midClef) + midClef.width.total)
        })

        it('orders a clef before a key signature at the same beat', () => {
            const { m } = registeredMeasure()
            m.addNotes([pitched('C', 4, 'h'), pitched('E', 4, 'h')])
            m.setClef(2, 'bass')
            m.setKeySignature(2, 2)
            const midClef = m.clefAtBeat(2)
            const midKey = m.keyAtBeat(2)
            if (!midClef || !midKey) throw new Error('expected mid-measure clef and key')
            const layout = m.layout
            expect(layout.getXForElement(midClef)).toBeLessThan(layout.getXForElement(midKey))
            expect(layout.getXForElement(midKey)).toBeCloseTo(layout.getXForElement(midClef) + midClef.width.total)
        })

        it('orders mid-measure elements at different beats by beat', () => {
            const { m } = registeredMeasure()
            m.addNotes([pitched('C', 4, 'q'), pitched('D', 4, 'q'), pitched('E', 4, 'q'), pitched('F', 4, 'q')])
            m.setClef(1, 'bass')
            m.setKeySignature(2, 2)
            const midClef = m.clefAtBeat(1)
            const midKey = m.keyAtBeat(2)
            if (!midClef || !midKey) throw new Error('expected mid-measure clef and key')
            expect(m.layout.getXForElement(midClef)).toBeLessThan(m.layout.getXForElement(midKey))
        })

        it('a mid-measure clef in an empty measure joins the leading run', () => {
            const { m } = registeredMeasure()
            m.setClef(2, 'bass')
            const midClef = m.clefAtBeat(2)
            if (!midClef) throw new Error('expected a mid-measure clef')
            // Leading run: leading clef, time signature, then the homeless mid clef.
            expect(m.layout.getXForElement(midClef)).toBe(m.clef.width.total + m.timeSignature.width.total)
        })

        it('a mid-measure element past the last note folds into the final note slot', () => {
            const { m } = registeredMeasure()
            m.addNotes([pitched('C', 4, 'h'), pitched('E', 4, 'h')])
            m.setClef(3, 'bass')
            const midClef = m.clefAtBeat(3)
            if (!midClef) throw new Error('expected a mid-measure clef')
            expect(m.layout.getXForElement(midClef)).toBeGreaterThan(m.layout.getXForElement(m.notes[1]))
        })
    })

    describe('note, key, and tuplet layout lookups', () => {
        it('noteLayoutFor returns the note layout that Note.layout delegates to', () => {
            const score = makeScore(1)
            const m = score.firstMeasure
            if (!m) throw new Error('expected firstMeasure')
            const note = m.notes[0]
            expect(m.layout.noteLayoutFor(note)).toBe(note.layout)
            expect(() => m.layout.noteLayoutFor(rest('q'))).toThrow('Note not part of this measure layout')
        })

        it('keyLayoutFor returns layouts for the leading and mid-measure keys', () => {
            const { score, m } = registeredMeasure()
            m.addNotes([pitched('C', 4, 'h'), pitched('E', 4, 'h')])
            score.setKeySignature(m.firstNote, 1)
            m.setKeySignature(2, 3)
            const midKey = m.keyAtBeat(2)
            if (!midKey) throw new Error('expected a mid-measure key')
            expect(m.layout.keyLayoutFor(m.keySignature).accidentals).toHaveLength(1)
            expect(m.layout.keyLayoutFor(midKey).accidentals).toHaveLength(3)
            expect(midKey.layout).toBe(m.layout.keyLayoutFor(midKey))
        })

        it('keyLayoutFor throws for a key signature from another measure', () => {
            const score = makeScore(2)
            const stranger = score.measures[1].keySignature
            expect(() => score.measures[0].layout.keyLayoutFor(stranger)).toThrow('Key signature not part of this measure layout')
        })

        it('tupletLayoutFor returns the tuplet layout and throws for strangers', () => {
            const { m } = registeredMeasure()
            m.addNotes([tripletEighth(), tripletEighth(), tripletEighth()])
            const tuplet = m.tuplets[0]
            if (!tuplet) throw new Error('expected a tuplet')
            expect(m.layout.tupletLayoutFor(tuplet)).toBe(tuplet.layout)

            const { m: other } = registeredMeasure()
            other.addNotes([tripletEighth(), tripletEighth(), tripletEighth()])
            const strangerTuplet = other.tuplets[0]
            if (!strangerTuplet) throw new Error('expected a tuplet')
            expect(() => m.layout.tupletLayoutFor(strangerTuplet)).toThrow('Tuplet not part of this measure layout')
        })

        it('beamFor maps beamed notes to their beam and others to undefined', () => {
            const { m } = registeredMeasure()
            m.addNotes([pitched('C', 4, '8'), pitched('C', 4, '8'), pitched('C', 4, 'q')])
            const layout = m.layout
            expect(layout.beams).toHaveLength(1)
            expect(layout.beamFor(m.notes[0])).toBe(layout.beams[0])
            expect(layout.beamFor(m.notes[1])).toBe(layout.beams[0])
            expect(layout.beamFor(m.notes[2])).toBeUndefined()
        })
    })

    describe('explicit-context guards (direct construction)', () => {
        function bareContext(): MeasureLayoutContext {
            return {
                x: 0,
                width: 300,
                rowIndex: 0,
                showsClef: false,
                showsKeySignature: false,
                showsTimeSignature: false,
                accidentals: new Map<Note, string | undefined>(),
                noteWidths: new Map<Note, NoteWidth>(),
                keyWidths: new Map<KeySignature, KeySignatureWidth>(),
                reuseSignature: 'direct-test',
            }
        }

        it('throws when a note width is missing from the context', () => {
            const m = new Measure(new Score(), 'treble', new TimeSignature(4, 4))
            m.addNotes([rest('q')])
            expect(() => new MeasureLayout(m, bareContext())).toThrow('Note width missing from layout context')
        })

        it('throws when a drawn key signature width is missing from the context', () => {
            const m = new Measure(new Score(), 'treble', new TimeSignature(4, 4), { keyFifths: 1 })
            const context = { ...bareContext(), showsKeySignature: true }
            expect(() => new MeasureLayout(m, context)).toThrow('Key signature width missing from layout context')
        })
    })
})
