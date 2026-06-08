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
