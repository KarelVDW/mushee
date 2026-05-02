import { describe, expect, it } from 'vitest'

import { MAX_MEASURES_PER_ROW, SCORE_WIDTH } from '@/components/notation/constants'

import { Duration } from '@/model/Duration'
import { Note } from '@/model/Note'
import { Pitch } from '@/model/Pitch'
import { Score } from '@/model/Score'

/**
 * Regression suite for ResizeError. Each test exercises a layout path that has
 * historically triggered or could trigger:
 *     `throw new ResizeError()`  ('Container too small')
 * inside Resizer (apps/web/src/model/util/Resizer.ts).
 *
 * The two callers are:
 *  - RowLayout: distributes SCORE_WIDTH among measures (each `minimum = measure.minimalWidth`)
 *  - MeasureLayout: distributes content width among notes (each `minimum = note.width.total`)
 *
 * RowLayout throws when `Σ measure.minimalWidth > SCORE_WIDTH` (or > maximumWidth in
 * incomplete-row mode). MeasureLayout throws when `Σ note.width.total > contentWidth`.
 * The latter should never happen if Measure._minimalWidth correctly reflects element
 * widths, since RowLayout always allots at least minimalWidth to each measure.
 */

const sixteenth = (octave = 4) =>
    new Note({ duration: new Duration({ type: '16' }), pitch: new Pitch({ name: 'C', octave }) })

const sixteenthSharp = (octave = 4) =>
    new Note({
        duration: new Duration({ type: '16' }),
        pitch: new Pitch({ name: 'C', octave, accidental: '#' }),
    })

const tripletSixteenth = () =>
    new Note({
        duration: new Duration({ type: '16', ratio: { actualNotes: 3, normalNotes: 2 } }),
        pitch: new Pitch({ name: 'C', octave: 4 }),
    })

describe('ResizeError regressions', () => {
    describe('row-level overflow', () => {
        it('does not throw when a single measure is filled with 16 sixteenths (4/4)', () => {
            const score = new Score()
            const m = score.addMeasure()
            const notes: Note[] = []
            for (let i = 0; i < 16; i++) notes.push(sixteenth())
            m.addNotes(notes)
            for (const row of score.rows) {
                expect(() => row.layout).not.toThrow()
            }
        })

        it('does not throw with 4 measures of 16 sixteenths each (max-density row)', () => {
            const score = new Score()
            for (let i = 0; i < MAX_MEASURES_PER_ROW; i++) {
                const m = score.addMeasure()
                const notes: Note[] = []
                for (let j = 0; j < 16; j++) notes.push(sixteenth())
                m.addNotes(notes)
            }
            for (const row of score.rows) {
                expect(() => row.layout).not.toThrow()
            }
        })

        it('does not throw with sixteenths + accidentals (wider notes)', () => {
            const score = new Score()
            for (let i = 0; i < MAX_MEASURES_PER_ROW; i++) {
                const m = score.addMeasure()
                const notes: Note[] = []
                for (let j = 0; j < 16; j++) notes.push(sixteenthSharp())
                m.addNotes(notes)
            }
            for (const row of score.rows) {
                expect(() => row.layout).not.toThrow()
            }
        })

        it('does not throw when a triplet packs more sixteenths into a beat', () => {
            // Triplet sixteenths: 3 in time of 2, so 6 per quarter beat = 24 per 4/4 measure.
            const score = new Score()
            const m = score.addMeasure()
            const notes: Note[] = []
            for (let i = 0; i < 24; i++) notes.push(tripletSixteenth())
            m.addNotes(notes)
            for (const row of score.rows) {
                expect(() => row.layout).not.toThrow()
            }
        })

        it('handles a measure whose minimalWidth approaches SCORE_WIDTH', () => {
            const score = new Score()
            const m = score.addMeasure()
            // Add many wide notes (sharp 16ths) until just under SCORE_WIDTH
            const notes: Note[] = []
            // Practical max for a 4/4 measure: 16 sixteenths = 4 beats. Width ~ 16*40 + clef + timesig + barline ≈ 700.
            // Should comfortably fit.
            for (let i = 0; i < 16; i++) notes.push(sixteenthSharp())
            m.addNotes(notes)
            expect(m.minimalWidth).toBeLessThan(SCORE_WIDTH)
            expect(() => score.firstRow!.layout).not.toThrow()
        })
    })

    describe('measure-level overflow (note widths exceed measure content area)', () => {
        it('densifying measures after row assignment splits rows correctly (regression)', () => {
            // Historical bug: Score.addMeasure() ran _rebuildRows() while each measure was
            // empty (minimalWidth = absolute floor of 200), so canFit happily packed up to
            // four per row. The caller then mutated each measure with addNotes(...), which
            // recomputed _minimalWidth but did NOT signal Score to re-evaluate row
            // composition. RowLayout's Resizer then threw ResizeError ("Container too
            // small") on the next layout access.
            //
            // Fix: Measure.rebuildPhysicalElements now calls Score.onMeasureWidthChanged
            // whenever _minimalWidth changes, prompting a row rebuild.
            const score = new Score()
            for (let i = 0; i < 8; i++) {
                const m = score.addMeasure()
                const notes: Note[] = []
                for (let j = 0; j < 16; j++) notes.push(sixteenthSharp())
                m.addNotes(notes)
            }
            for (const m of score.measures) expect(() => m.layout).not.toThrow()
            for (const row of score.rows) expect(() => row.layout).not.toThrow()
        })
    })

    describe('mutation paths that historically caused stale minimalWidth', () => {
        it('replacing notes recomputes minimalWidth so layout fits', () => {
            const score = new Score()
            const m = score.addMeasure()
            // Start sparse
            m.addNotes([
                new Note({ duration: new Duration({ type: 'q' }) }),
                new Note({ duration: new Duration({ type: 'q' }) }),
                new Note({ duration: new Duration({ type: 'q' }) }),
                new Note({ duration: new Duration({ type: 'q' }) }),
            ])
            const before = m.minimalWidth
            // Now densify by replacing a quarter rest with 4 sharp 16ths
            const target = m.firstNote!
            const replacements: Note[] = []
            for (let i = 0; i < 4; i++) replacements.push(sixteenthSharp())
            m.replaceNotes([target], replacements)
            expect(m.minimalWidth).toBeGreaterThanOrEqual(before)
            expect(() => score.firstRow!.layout).not.toThrow()
            expect(() => m.layout).not.toThrow()
        })

        it('removing notes shrinks minimalWidth (or stays at absolute minimum)', () => {
            const score = new Score()
            const m = score.addMeasure()
            const dense: Note[] = []
            for (let i = 0; i < 16; i++) dense.push(sixteenthSharp())
            m.addNotes(dense)
            const denseWidth = m.minimalWidth
            m.removeNotes(dense)
            // Empty measure → absolute minimum
            expect(m.minimalWidth).toBeLessThanOrEqual(denseWidth)
        })

        it('toggling endBarline updates minimalWidth without breaking layout', () => {
            const score = new Score()
            const m = score.addMeasure()
            for (let i = 0; i < 12; i++) m.addNotes([sixteenthSharp()])
            const before = m.minimalWidth
            m.setEndBarline('end')
            expect(m.minimalWidth).toBeGreaterThanOrEqual(before)
            expect(() => score.firstRow!.layout).not.toThrow()
        })
    })

    describe('Score-level operations', () => {
        it('addMeasure followed by removeLastMeasure leaves layout intact', () => {
            const score = new Score()
            for (let i = 0; i < 5; i++) score.addMeasure().complete()
            score.removeLastMeasure()
            for (const row of score.rows) expect(() => row.layout).not.toThrow()
        })

        it('Score.replace across measure boundaries does not throw', () => {
            const score = new Score()
            for (let i = 0; i < 2; i++) score.addMeasure().complete()
            const target = score.firstMeasure!.firstNote!
            const longNote = new Note({ duration: new Duration({ type: 'w' }) })
            expect(() => score.replace([target], [longNote])).not.toThrow()
            for (const row of score.rows) expect(() => row.layout).not.toThrow()
        })

        it('per-note insertion still triggers row rebuild (regression)', () => {
            // Same as above but interleaving addNotes calls. Confirms that the per-note
            // path also signals Score correctly — not just bulk addNotes.
            const score = new Score()
            for (let i = 0; i < 8; i++) {
                const m = score.addMeasure()
                for (let j = 0; j < 16; j++) m.addNotes([sixteenthSharp()])
            }
            for (const m of score.measures) expect(() => m.layout).not.toThrow()
        })

        it('5 dense measures lay out without throwing (minimal repro of fixed bug)', () => {
            const score = new Score()
            for (let i = 0; i < 5; i++) {
                const m = score.addMeasure()
                for (let j = 0; j < 16; j++) m.addNotes([sixteenthSharp()])
            }
            expect(() => {
                for (const m of score.measures) m.layout
            }).not.toThrow()
            // Each dense measure should now occupy its own row (canFit refuses pairing).
            // We don't pin the exact count, but every row must lay out cleanly.
            for (const row of score.rows) expect(() => row.layout).not.toThrow()
        })

        it('densified measures end up split across rows (no row exceeds SCORE_WIDTH minimums)', () => {
            const score = new Score()
            for (let i = 0; i < 5; i++) {
                const m = score.addMeasure()
                for (let j = 0; j < 16; j++) m.addNotes([sixteenthSharp()])
            }
            for (const row of score.rows) {
                const totalMinimum = row.measures.reduce((s, m) => s + m.minimalWidth, 0)
                expect(totalMinimum).toBeLessThanOrEqual(SCORE_WIDTH)
            }
        })
    })
})
