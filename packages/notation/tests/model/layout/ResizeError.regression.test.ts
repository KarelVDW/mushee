import { MAX_MEASURES_PER_ROW, MEASURE_BUTTON_SPACING, SCORE_WIDTH } from '@mushee/notation/components/constants'
import { Duration } from '@mushee/notation/model/Duration'
import { Note } from '@mushee/notation/model/Note'
import { Pitch } from '@mushee/notation/model/Pitch'
import { Score } from '@mushee/notation/model/Score'
import { describe, expect, it } from 'vitest'

/**
 * Regression suite for ResizeError ('Container too small', thrown by Resizer).
 * Historically the model's eagerly-maintained row composition could go stale
 * against measure widths (densifying after row assignment, button-spacing
 * boundary, etc.). The packing now lives in ScoreLayout and recomputes per
 * version, so these scenarios must always lay out cleanly — each test builds a
 * historical trigger and asserts the layout resolves without throwing and
 * within the row budgets.
 */

const sixteenth = (octave = 4) => new Note({ duration: new Duration({ type: '16' }), pitch: new Pitch({ name: 'C', octave }) })

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

/** Force every row's geometry to resolve; throws if any Resizer overflows. */
function layOutAllRows(score: Score) {
    for (const row of score.layout.rows) void row.width
    for (const m of score.measures) void m.layout.barline
}

describe('ResizeError regressions', () => {
    describe('row-level overflow', () => {
        it('does not throw when a single measure is filled with 16 sixteenths (4/4)', () => {
            const score = new Score()
            const m = score.addMeasure()
            const notes: Note[] = []
            for (let i = 0; i < 16; i++) notes.push(sixteenth())
            m.addNotes(notes)
            expect(() => layOutAllRows(score)).not.toThrow()
        })

        it('does not throw with 4 measures of 16 sixteenths each (max-density row)', () => {
            const score = new Score()
            for (let i = 0; i < MAX_MEASURES_PER_ROW; i++) {
                const m = score.addMeasure()
                const notes: Note[] = []
                for (let j = 0; j < 16; j++) notes.push(sixteenth())
                m.addNotes(notes)
            }
            expect(() => layOutAllRows(score)).not.toThrow()
        })

        it('does not throw with sixteenths + accidentals (wider notes)', () => {
            const score = new Score()
            for (let i = 0; i < MAX_MEASURES_PER_ROW; i++) {
                const m = score.addMeasure()
                const notes: Note[] = []
                for (let j = 0; j < 16; j++) notes.push(sixteenthSharp())
                m.addNotes(notes)
            }
            expect(() => layOutAllRows(score)).not.toThrow()
        })

        it('does not throw when a triplet packs more sixteenths into a beat', () => {
            // Triplet sixteenths: 3 in time of 2, so 6 per quarter beat = 24 per 4/4 measure.
            const score = new Score()
            const m = score.addMeasure()
            const notes: Note[] = []
            for (let i = 0; i < 24; i++) notes.push(tripletSixteenth())
            m.addNotes(notes)
            expect(() => layOutAllRows(score)).not.toThrow()
        })

        it('handles a measure whose width approaches SCORE_WIDTH (alone on its row)', () => {
            const score = new Score()
            const m = score.addMeasure()
            for (let i = 0; i < 16; i++) m.addNotes([sixteenthSharp()])
            const row = score.layout.rowFor(m)
            expect(row.measures).toEqual([m])
            expect(row.width).toBeLessThanOrEqual(SCORE_WIDTH)
            expect(() => layOutAllRows(score)).not.toThrow()
        })
    })

    describe('measure-level overflow (note widths exceed measure content area)', () => {
        it('densifying measures after row assignment splits rows correctly (regression)', () => {
            // Historical bug: rows were composed while each measure was still empty
            // (minimal width = absolute floor), then addNotes(...) widened the measures
            // without re-evaluating row composition → ResizeError on layout access.
            // Packing now recomputes lazily per version, so the dense measures split.
            const score = new Score()
            for (let i = 0; i < 8; i++) {
                const m = score.addMeasure()
                const notes: Note[] = []
                for (let j = 0; j < 16; j++) notes.push(sixteenthSharp())
                m.addNotes(notes)
            }
            expect(score.layout.rows.length).toBeGreaterThan(1)
            expect(() => layOutAllRows(score)).not.toThrow()
        })
    })

    describe('mutation paths that historically caused stale row composition', () => {
        it('replacing notes re-packs so layout fits', () => {
            const score = new Score()
            const m = score.addMeasure()
            // Start sparse
            m.addNotes([
                new Note({ duration: new Duration({ type: 'q' }) }),
                new Note({ duration: new Duration({ type: 'q' }) }),
                new Note({ duration: new Duration({ type: 'q' }) }),
                new Note({ duration: new Duration({ type: 'q' }) }),
            ])
            // Now densify by replacing a quarter rest with 4 sharp 16ths
            const target = m.firstNote
            if (!target) throw new Error('expected firstNote')
            const replacements: Note[] = []
            for (let i = 0; i < 4; i++) replacements.push(sixteenthSharp())
            m.replaceNotes([target], replacements)
            expect(() => layOutAllRows(score)).not.toThrow()
        })

        it('removing every note still lays out (empty-measure path)', () => {
            const score = new Score()
            const m = score.addMeasure()
            const dense: Note[] = []
            for (let i = 0; i < 16; i++) dense.push(sixteenthSharp())
            m.addNotes(dense)
            expect(() => layOutAllRows(score)).not.toThrow()
            m.removeNotes(dense)
            expect(() => layOutAllRows(score)).not.toThrow()
        })

        it('toggling endBarline re-packs without breaking layout', () => {
            const score = new Score()
            const m = score.addMeasure()
            for (let i = 0; i < 12; i++) m.addNotes([sixteenthSharp()])
            m.setEndBarline('end')
            expect(() => layOutAllRows(score)).not.toThrow()
        })
    })

    describe('Score-level operations', () => {
        it('addMeasure followed by removeLastMeasure leaves layout intact', () => {
            const score = new Score()
            for (let i = 0; i < 5; i++) score.addMeasure().complete()
            score.removeLastMeasure()
            expect(() => layOutAllRows(score)).not.toThrow()
        })

        it('Score.replace across measure boundaries does not throw', () => {
            const score = new Score()
            for (let i = 0; i < 2; i++) score.addMeasure().complete()
            const firstMeasure = score.firstMeasure
            if (!firstMeasure) throw new Error('expected firstMeasure')
            const target = firstMeasure.firstNote
            if (!target) throw new Error('expected firstNote')
            const longNote = new Note({ duration: new Duration({ type: 'w' }) })
            expect(() => score.replace([target], [longNote])).not.toThrow()
            expect(() => layOutAllRows(score)).not.toThrow()
        })

        it('per-note insertion still re-packs correctly (regression)', () => {
            // Interleaved addNotes calls: every increment must be reflected in the next layout read.
            const score = new Score()
            for (let i = 0; i < 8; i++) {
                const m = score.addMeasure()
                for (let j = 0; j < 16; j++) m.addNotes([sixteenthSharp()])
            }
            expect(() => layOutAllRows(score)).not.toThrow()
        })

        it('5 dense measures lay out without throwing (minimal repro of fixed bug)', () => {
            const score = new Score()
            for (let i = 0; i < 5; i++) {
                const m = score.addMeasure()
                for (let j = 0; j < 16; j++) m.addNotes([sixteenthSharp()])
            }
            expect(() => layOutAllRows(score)).not.toThrow()
        })

        it('densified measures end up split across rows within the score width', () => {
            const score = new Score()
            for (let i = 0; i < 5; i++) {
                const m = score.addMeasure()
                for (let j = 0; j < 16; j++) m.addNotes([sixteenthSharp()])
            }
            expect(score.layout.rows.length).toBeGreaterThan(1)
            for (const row of score.layout.rows) {
                expect(row.width).toBeLessThanOrEqual(SCORE_WIDTH)
            }
        })
    })

    describe('narrow layout widths (mobile reflow)', () => {
        // Regression: Score.setLayoutWidth packs rows against the container on
        // phones (down to 340). A single dense measure whose minimum width
        // exceeds that budget was packed alone on its row and then threw at
        // layout time. The layout now widens to fit the densest measure and
        // views scale it down instead.
        it('a dense measure lays out at the minimum reflow width instead of throwing', () => {
            const score = new Score()
            const m = score.addMeasure()
            for (let i = 0; i < 16; i++) m.addNotes([sixteenthSharp()])
            score.setLayoutWidth(340)
            expect(() => layOutAllRows(score)).not.toThrow()
            for (const row of score.layout.rows) {
                expect(row.width).toBeLessThanOrEqual(score.layout.scoreWidth)
            }
        })

        it('widens the layout only as far as the densest measure requires', () => {
            const score = new Score()
            const dense = score.addMeasure()
            for (let i = 0; i < 16; i++) dense.addNotes([sixteenthSharp()])
            score.addMeasure().complete()
            score.setLayoutWidth(340)
            const layout = score.layout
            expect(layout.scoreWidth).toBeGreaterThan(340)
            // The dense row must fit its widened budget exactly — no leftover throw margin.
            const denseRow = layout.rowFor(dense)
            expect(denseRow.width).toBeLessThanOrEqual(layout.scoreWidth)
        })

        it('keeps the requested width when every measure fits it', () => {
            const score = new Score()
            for (let i = 0; i < 3; i++) score.addMeasure().complete()
            score.setLayoutWidth(340)
            expect(score.layout.scoreWidth).toBe(340)
            expect(() => layOutAllRows(score)).not.toThrow()
        })

        it('an over-dense measure also lays out at full desktop width', () => {
            // Not just a mobile concern: enough triplet sixteenths with accidentals
            // can exceed even SCORE_WIDTH.
            const score = new Score()
            const m = score.addMeasure()
            const notes: Note[] = []
            for (let i = 0; i < 24; i++)
                notes.push(
                    new Note({
                        duration: new Duration({ type: '16', ratio: { actualNotes: 3, normalNotes: 2 } }),
                        pitch: new Pitch({ name: 'C', octave: 4, accidental: '#' }),
                    }),
                )
            m.addNotes(notes)
            expect(() => layOutAllRows(score)).not.toThrow()
            for (const row of score.layout.rows) {
                expect(row.width).toBeLessThanOrEqual(score.layout.scoreWidth)
            }
        })
    })

    describe('last-row button-spacing boundary', () => {
        // Regression: row fitting historically used SCORE_WIDTH, but the last row
        // reserves MEASURE_BUTTON_SPACING for the +/- measure buttons. Measures whose
        // minimums summed into that reserve packed onto the row but threw at layout time.
        // Packing now always reserves the button space while fitting.
        it('two measures whose minimums would sum into the button-spacing zone lay out cleanly', () => {
            const score = new Score()
            const m1 = score.addMeasure()
            for (let j = 0; j < 10; j++) m1.addNotes([sixteenthSharp()])
            const m2 = score.addMeasure()
            for (let j = 0; j < 16; j++) m2.addNotes([sixteenthSharp()])
            expect(() => layOutAllRows(score)).not.toThrow()
        })

        it('three measures crossing the budget boundary lay out cleanly', () => {
            const score = new Score()
            for (let i = 0; i < 3; i++) {
                const m = score.addMeasure()
                for (let j = 0; j < 13; j++) m.addNotes([sixteenthSharp()])
            }
            expect(() => layOutAllRows(score)).not.toThrow()
        })

        it('the last row never exceeds its button-reserving budget', () => {
            const score = new Score()
            for (let i = 0; i < 6; i++) {
                const m = score.addMeasure()
                for (let j = 0; j < 12; j++) m.addNotes([sixteenthSharp()])
            }
            const rows = score.layout.rows
            const lastRow = rows[rows.length - 1]
            expect(lastRow.isLastRow).toBe(true)
            expect(lastRow.width).toBeLessThanOrEqual(SCORE_WIDTH - MEASURE_BUTTON_SPACING)
            for (const row of rows) expect(row.width).toBeLessThanOrEqual(SCORE_WIDTH)
        })
    })
})
