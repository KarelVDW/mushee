import { defaults, makeScore, pitched, rest } from '@test/helpers'
import { describe, expect, it } from 'vitest'

import { Duration } from '@/model/Duration'
import { Measure } from '@/model/Measure'
import { Note } from '@/model/Note'
import { Score } from '@/model/Score'

describe('MeasureLayout', () => {
    it('builds a layout for a default 4/4 measure with rests', () => {
        const score = makeScore(1)
        const m = score.firstMeasure
        if (!m) throw new Error('expected firstMeasure')
        expect(() => m.layout).not.toThrow()
        expect(m.layout.measureX).toBeGreaterThanOrEqual(0)
        expect(m.layout.measureWidth).toBeGreaterThan(0)
    })

    it('positions notes in measure-relative coordinates', () => {
        const score = new Score()
        const m = score.addMeasure()
        m.addNotes([rest('q'), rest('q'), rest('q'), rest('q')])
        const layout = m.layout
        const firstNote = m.firstNote
        if (!firstNote) throw new Error('expected firstNote')
        const lastNote = m.lastNote
        if (!lastNote) throw new Error('expected lastNote')
        const firstX = layout.getXForElement(firstNote)
        const lastX = layout.getXForElement(lastNote)
        expect(lastX).toBeGreaterThan(firstX)
    })

    it('throws "Element not spaced in measure" for unknown elements', () => {
        const score = makeScore(1)
        const m = score.firstMeasure
        if (!m) throw new Error('expected firstMeasure')
        const stranger = rest('q')
        expect(() => m.layout.getXForElement(stranger)).toThrow('Element not spaced in measure')
    })

    it('getNoteForX returns the note whose range contains x', () => {
        const score = makeScore(1)
        const m = score.firstMeasure
        if (!m) throw new Error('expected firstMeasure')
        const firstNote = m.firstNote
        if (!firstNote) throw new Error('expected firstNote')
        const x = m.layout.getXForElement(firstNote)
        expect(m.layout.getNoteForX(x)).toBe(firstNote)
    })

    it('getNoteForX returns null when x is outside any note range', () => {
        const score = makeScore(1)
        const m = score.firstMeasure
        if (!m) throw new Error('expected firstMeasure')
        expect(m.layout.getNoteForX(-1)).toBeNull()
        expect(m.layout.getNoteForX(99999)).toBeNull()
    })

    it('getXForBeat is monotonically non-decreasing across the measure', () => {
        const score = makeScore(1)
        const m = score.firstMeasure
        if (!m) throw new Error('expected firstMeasure')
        const layout = m.layout
        let prev = -Infinity
        for (let beat = 0; beat <= m.maxBeats; beat += 0.25) {
            const x = layout.getXForBeat(beat)
            expect(x).toBeGreaterThanOrEqual(prev - 0.0001)
            prev = x
        }
    })

    describe('barline', () => {
        it('returns a barline with positive height for default end barline', () => {
            const score = makeScore(1)
            const m = score.firstMeasure
            if (!m) throw new Error('expected firstMeasure')
            const bar = m.layout.barline
            if (!bar) throw new Error('expected barline')
            expect(bar.height).toBeGreaterThan(0)
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
            m.setEndBarline(undefined) // exercise the `?? 'single'` fallback (nullish branch)
            const bar = m.layout.barline
            if (!bar) throw new Error('expected barline')
            expect(bar.type).toBe('single')
        })

        it('uses an explicitly set barline type', () => {
            const score = makeScore(1)
            const m = score.firstMeasure
            if (!m) throw new Error('expected firstMeasure')
            m.setEndBarline('double') // non-nullish left side of `??`
            const bar = m.layout.barline
            if (!bar) throw new Error('expected barline')
            expect(bar.type).toBe('double')
            // The barline sits at the right edge of the measure content (minus the barline width).
            expect(bar.x).toBeCloseTo(m.layout.measureWidth - m.barlineWidth)
        })
    })

    describe('with shown clef and time signature', () => {
        it('builds a layout when clef and time signature are visible', () => {
            const score = makeScore(1)
            const m = score.firstMeasure
            if (!m) throw new Error('expected firstMeasure')
            // First measure of first row already shows them via _rebuildRows.
            expect(m.showsClef).toBe(true)
            expect(m.showsTimeSignature).toBe(true)
            expect(() => m.layout).not.toThrow()
            expect(m.layout.getXForElement(m.clef)).toBeGreaterThanOrEqual(0)
            expect(m.layout.getXForElement(m.timeSignature)).toBeGreaterThan(m.layout.getXForElement(m.clef))
        })
    })

    describe('crowded measures (potential ResizeError sources)', () => {
        it('handles a measure full of 16th notes without throwing', () => {
            const score = new Score()
            const m = score.addMeasure()
            // Replace the rests added by complete() with 16 sixteenth notes
            const sixteenths: Note[] = []
            for (let i = 0; i < 16; i++) sixteenths.push(pitched('C', 4, '16'))
            m.addNotes(sixteenths)
            expect(() => m.layout).not.toThrow()
        })

        it('handles many sixteenths with accidentals', () => {
            const score = new Score()
            const m = score.addMeasure()
            const basePitch = pitched('C', 4).pitch
            if (!basePitch) throw new Error('expected pitch')
            const sharpPitch = basePitch.withAccidental('#')
            const sixteenths: Note[] = []
            for (let i = 0; i < 16; i++) {
                sixteenths.push(
                    new Note({
                        duration: new Duration({ type: '16' }),
                        pitch: sharpPitch,
                    }),
                )
            }
            m.addNotes(sixteenths)
            expect(() => m.layout).not.toThrow()
        })
    })

    describe('getXForBeat edge cases', () => {
        it('returns 0 for a measure with no notes', () => {
            const score = new Score()
            const m = score.addMeasure() // bare measure: no auto-filled rests
            expect(m.notes).toHaveLength(0)
            expect(m.layout.getXForBeat(0)).toBe(0)
        })

        it('falls back to the first note for a beat before the measure start', () => {
            const score = makeScore(1)
            const m = score.firstMeasure
            if (!m) throw new Error('expected firstMeasure')
            const firstNote = m.firstNote
            if (!firstNote) throw new Error('expected firstNote')
            // A negative beat makes the first note "overshoot" (offset 0 > -1), so overshootIndex
            // is 0 and notes[-1] is undefined → the `|| firstNote` fallback is taken. The result
            // interpolates from the first note's x with a negative offset (beat < its start).
            const x = m.layout.getXForBeat(-1)
            expect(x).toBeLessThan(m.layout.getXForElement(firstNote))
            expect(Number.isFinite(x)).toBe(true)
        })
    })

    describe('mid-measure key signature (child element folded into preceding note)', () => {
        it('spaces a mid-measure key change alongside the note at its beat', () => {
            const score = new Score()
            const m = score.addMeasure()
            m.addNotes([pitched('C', 4, 'h'), pitched('E', 4, 'h')])
            // A key change to 2 sharps at beat 2 draws accidentals and has no `beats`, so it
            // folds in as a child element of the preceding note slot.
            m.setKeySignature(2, 2)
            const midKey = m.midMeasureKeySignatures[0]
            if (!midKey) throw new Error('expected a mid-measure key signature')
            const layout = m.layout
            const noteAtTwo = m.notes[1]
            expect(layout.getXForElement(midKey)).toBeLessThanOrEqual(layout.getXForElement(noteAtTwo))
        })
    })

    describe('mid-measure clef (child element folded into preceding note)', () => {
        it('spaces a mid-measure clef and the note that follows it at the same beat', () => {
            const score = new Score()
            const m = score.addMeasure()
            m.addNotes([pitched('C', 4, 'q'), pitched('D', 4, 'q'), pitched('E', 4, 'q'), pitched('F', 4, 'q')])
            // A clef change at beat 2 has no `beats`, so it folds into the preceding sizeable
            // element as a child (lines 41-42) and is x-positioned within that slot (lines 62-66).
            m.setClef(2, 'bass')
            const midClef = m.midMeasureClefs[0]
            if (!midClef) throw new Error('expected a mid-measure clef')

            const layout = m.layout
            const clefX = layout.getXForElement(midClef)
            // The clef sits within the measure, to the right of the first note.
            const firstNote = m.firstNote
            if (!firstNote) throw new Error('expected firstNote')
            expect(clefX).toBeGreaterThan(layout.getXForElement(firstNote))
            // The note at beat 2 is placed immediately after the clef glyph (child width reclaimed).
            const noteAtTwo = m.notes[2]
            expect(layout.getXForElement(noteAtTwo)).toBeGreaterThanOrEqual(clefX)
        })

        it('places the mid-measure clef before the note that shares its beat', () => {
            const score = new Score()
            const m = score.addMeasure()
            m.addNotes([pitched('C', 4, 'h'), pitched('E', 4, 'h')])
            m.setClef(2, 'bass')
            const midClef = m.midMeasureClefs[0]
            if (!midClef) throw new Error('expected a mid-measure clef')
            const layout = m.layout
            // Clef and the beat-2 note occupy the same slot; the clef glyph comes first.
            const noteAtTwo = m.notes[1]
            expect(layout.getXForElement(midClef)).toBeLessThanOrEqual(layout.getXForElement(noteAtTwo))
        })
    })

    describe('orphan measure (no row)', () => {
        it('throws "Measure not part of a row" when computing layout', () => {
            const score = new Score()
            const { clefType, timeSignature } = defaults()
            const orphan = new Measure(score, clefType, timeSignature)
            // Measure exists but Score never registered it, so no row.
            expect(() => orphan.layout).toThrow('Measure not part of a row')
        })
    })
})
