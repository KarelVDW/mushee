import { MAX_MEASURES_PER_ROW, MEASURE_BUTTON_SPACING, ROW_GAP, ROW_HEIGHT, SCORE_WIDTH } from '@mushee/notation/components/constants'
import { Duration } from '@mushee/notation/model/Duration'
import { Measure } from '@mushee/notation/model/Measure'
import { Note } from '@mushee/notation/model/Note'
import { Pitch } from '@mushee/notation/model/Pitch'
import { Score } from '@mushee/notation/model/Score'
import { TimeSignature } from '@mushee/notation/model/TimeSignature'
import { makeScore, pitched } from '@mushee/notation/testing'
import { describe, expect, it } from 'vitest'

/**
 * Deterministic widths from the glyph mock (tests/setup.ts):
 *   plain 16th = 26, sharp 16th = 35, treble clef = 28, 4/4 time signature = 26,
 *   one-sharp key = 22, single barline = 1, end barline = 7.
 * The greedy packing budget reserves measure-button space on every row:
 *   SCORE_WIDTH − MEASURE_BUTTON_SPACING = 970.
 */
const BUDGET = SCORE_WIDTH - MEASURE_BUTTON_SPACING

const plain16 = () => new Note({ duration: new Duration({ type: '16' }), pitch: new Pitch({ name: 'C', octave: 4 }) })

/** n sharp sixteenths on distinct (name, octave) pairs so every one draws its accidental (35px each). */
function distinctSharps(n: number): Note[] {
    const names = ['C', 'D', 'E', 'G', 'A', 'B']
    return Array.from({ length: n }, (_, i) => {
        const pitch = new Pitch({ name: names[i % names.length], octave: 5 + Math.floor(i / names.length), accidental: '#', alter: 1 })
        return new Note({ duration: new Duration({ type: '16' }), pitch })
    })
}

describe('ScoreLayout', () => {
    it('exposes the score-level constants', () => {
        const score = makeScore(1)
        expect(score.layout.scoreWidth).toBe(SCORE_WIDTH)
        expect(score.layout.rowGap).toBe(ROW_GAP)
        expect(score.layout.rowHeight).toBe(ROW_HEIGHT)
    })

    it('returns the same snapshot instance while the score is unmutated', () => {
        const score = makeScore(2)
        expect(score.layout).toBe(score.layout)
    })

    it('rebuilds a new snapshot after a mutation', () => {
        const score = makeScore(2)
        const before = score.layout
        const m = score.firstMeasure
        if (!m) throw new Error('expected a measure')
        m.setEndBarline('double')
        expect(score.layout).not.toBe(before)
    })

    it('totalHeight is rowCount × rowHeight + gaps', () => {
        const score = makeScore(8) // 8 sparse measures → 2 rows of 4
        expect(score.layout.rows).toHaveLength(2)
        expect(score.layout.totalHeight).toBe(2 * ROW_HEIGHT + ROW_GAP)
    })

    it('an empty score has no rows, no ties, and zero height', () => {
        const score = new Score()
        expect(score.layout.rows).toHaveLength(0)
        expect(score.layout.ties).toHaveLength(0)
        expect(score.layout.totalHeight).toBe(0)
    })

    it('getYForRow returns row.index × (rowHeight + rowGap)', () => {
        const score = makeScore(8)
        expect(score.layout.getYForRow(score.layout.rows[0])).toBe(0)
        expect(score.layout.getYForRow(score.layout.rows[1])).toBe(ROW_HEIGHT + ROW_GAP)
    })

    it('getRowForY maps a y coordinate into the right row band', () => {
        const score = makeScore(8)
        expect(score.layout.getRowForY(0)).toBe(score.layout.rows[0])
        expect(score.layout.getRowForY(ROW_HEIGHT + ROW_GAP + 1)).toBe(score.layout.rows[1])
        expect(score.layout.getRowForY(10 * (ROW_HEIGHT + ROW_GAP))).toBeUndefined()
    })

    describe('lookups', () => {
        it('rowFor returns the row holding the measure', () => {
            const score = makeScore(5) // rows of 4 + 1
            const first = score.measures[0]
            const last = score.measures[4]
            expect(score.layout.rowFor(first)).toBe(score.layout.rows[0])
            expect(score.layout.rowFor(last)).toBe(score.layout.rows[1])
        })

        it('rowFor throws for a measure that is not part of the score', () => {
            const score = makeScore(1)
            const stranger = new Measure(new Score(), 'treble', new TimeSignature(4, 4))
            expect(() => score.layout.rowFor(stranger)).toThrow('Measure not part of a row')
        })

        it('measureLayoutFor throws for a measure that is not part of the score', () => {
            const score = makeScore(1)
            const stranger = new Measure(new Score(), 'treble', new TimeSignature(4, 4))
            expect(() => score.layout.measureLayoutFor(stranger)).toThrow('Measure not part of this score layout')
        })

        it('Measure.layout delegates into the score layout and throws when unregistered', () => {
            const score = makeScore(1)
            const m = score.firstMeasure
            if (!m) throw new Error('expected a measure')
            expect(m.layout).toBe(score.layout.measureLayoutFor(m))

            const orphan = new Measure(score, 'treble', new TimeSignature(4, 4)) // never registered via addMeasure
            expect(() => orphan.layout).toThrow('Measure not part of this score layout')
        })
    })

    describe('row packing', () => {
        it('caps rows at MAX_MEASURES_PER_ROW', () => {
            const score = makeScore(MAX_MEASURES_PER_ROW + 1)
            expect(score.layout.rows[0].measures).toHaveLength(MAX_MEASURES_PER_ROW)
            expect(score.layout.rows[1].measures).toHaveLength(1)
        })

        it('reserves measure-button space on every row while fitting (splits above 970, not 1000)', () => {
            // m0 = 429 fixed + 54 (clef + 4/4) = 483; m1 = 488 fixed + 7 (end barline) = 495.
            // Sum 978 ≤ SCORE_WIDTH but > budget (970) → the pair splits across two rows.
            const score = new Score()
            score.addMeasure().addNotes([...distinctSharps(10), plain16(), plain16(), plain16()])
            score.addMeasure().addNotes([...distinctSharps(8), ...Array.from({ length: 8 }, plain16)])
            expect(score.layout.rows).toHaveLength(2)
            expect(score.layout.rows[0].measures).toHaveLength(1)
        })

        it('packs two measures onto one row when their minimal widths stay within the budget', () => {
            // m0 = 483 as above; m1 = 460 fixed + 7 = 467 → sum 950 ≤ 970 → same row.
            const score = new Score()
            score.addMeasure().addNotes([...distinctSharps(10), plain16(), plain16(), plain16()])
            score.addMeasure().addNotes([...distinctSharps(2), ...Array.from({ length: 15 }, plain16)])
            expect(score.layout.rows).toHaveLength(1)
            expect(score.layout.rows[0].measures).toHaveLength(2)
        })

        it('re-packs when a forced row-start clef changes which measures fit (fixed-point iteration)', () => {
            // Three light measures (209 each; m0 +54 for clef + time signature) and three dense ones
            // (316, 316, 322 with the end barline). First pass: [m0..m2], [m3, m4, m5] (954 ≤ 970).
            // Forcing the row-start clef on m3 (+28) pushes that row over budget, so the packing
            // settles on [m0..m2], [m3, m4], [m5] after further passes.
            const score = new Score()
            for (let i = 0; i < 3; i++) score.addMeasure().addNotes(Array.from({ length: 8 }, plain16))
            for (let i = 0; i < 3; i++) score.addMeasure().addNotes(distinctSharps(9))
            const layout = score.layout
            expect(layout.rows.map((row) => row.measures.length)).toEqual([3, 2, 1])
            expect(layout.rows[1].measures[0]).toBe(score.measures[3])
            expect(layout.rows[2].measures[0]).toBe(score.measures[5])
            // Every row start shows clef + key signature; mid-row measures show neither.
            expect(score.measures[3].layout.showsClef).toBe(true)
            expect(score.measures[3].layout.showsKeySignature).toBe(true)
            expect(score.measures[5].layout.showsClef).toBe(true)
            expect(score.measures[4].layout.showsClef).toBe(false)
        })

        it('clamps a wide measure to its minimal width and shares the rest of the row', () => {
            // m0 = 487 fixed + 54 = 541; m1..m3 are floored to the 200 absolute minimum.
            // 541 + 200 + 200 = 941 ≤ 970, +200 overflows → rows [m0..m2], [m3].
            const score = new Score()
            score.addMeasure().addNotes([...distinctSharps(2), ...Array.from({ length: 16 }, plain16)])
            for (let i = 0; i < 3; i++) score.addMeasure().complete()
            const layout = score.layout
            expect(layout.rows.map((row) => row.measures.length)).toEqual([3, 1])
            const row = layout.rows[0]
            expect(row.width).toBe(SCORE_WIDTH) // non-last rows stretch edge to edge
            expect(row.getMeasureWidth(score.measures[0])).toBeCloseTo(541)
            // The two light measures split the leftover space evenly.
            expect(row.getMeasureWidth(score.measures[1])).toBeCloseTo((SCORE_WIDTH - 541) / 2)
            expect(row.getMeasureWidth(score.measures[2])).toBeCloseTo((SCORE_WIDTH - 541) / 2)
        })

        it('a last row with three measures stretches to the budget width', () => {
            const score = makeScore(3)
            expect(score.layout.rows[0].width).toBe(BUDGET)
        })

        it('a last row with at most two measures keeps natural widths', () => {
            const score = makeScore(2)
            // Two near-empty measures at the default width of budget / MAX_MEASURES_PER_ROW each.
            expect(score.layout.rows[0].width).toBeCloseTo((BUDGET / MAX_MEASURES_PER_ROW) * 2)
        })
    })

    describe('shows-flags (diff-based against the previous measure)', () => {
        it('the first measure shows clef, key signature, and time signature', () => {
            const score = makeScore(2)
            const layout = score.measures[0].layout
            expect(layout.showsClef).toBe(true)
            expect(layout.showsKeySignature).toBe(true)
            expect(layout.showsTimeSignature).toBe(true)
        })

        it('a mid-row measure with unchanged context shows none of them', () => {
            const score = makeScore(2)
            const layout = score.measures[1].layout
            expect(layout.showsClef).toBe(false)
            expect(layout.showsKeySignature).toBe(false)
            expect(layout.showsTimeSignature).toBe(false)
        })

        it('a clef change shows the clef on that measure but not on its (inheriting) successor', () => {
            const score = makeScore(3)
            score.setClef(score.measures[1].firstNote, 'bass')
            expect(score.measures[1].layout.showsClef).toBe(true)
            expect(score.measures[2].clef.type).toBe('bass') // inherited
            expect(score.measures[2].layout.showsClef).toBe(false)
        })

        it('a mid-measure clef carries out of the measure (lastClef drives the diff)', () => {
            const score = makeScore(2)
            const m0 = score.measures[0]
            const noteAtTwo = m0.noteAtBeat(2)
            if (!noteAtTwo) throw new Error('expected a note at beat 2')
            score.setClef(noteAtTwo, 'bass')
            // m1 inherits bass, so its leading clef matches the carried-out clef → not shown.
            expect(score.measures[1].clef.type).toBe('bass')
            expect(score.measures[1].layout.showsClef).toBe(false)
        })

        it('a key change shows the key on that measure but not on its (inheriting) successor', () => {
            const score = makeScore(3)
            score.setKeySignature(score.measures[1].firstNote, 2)
            expect(score.measures[1].layout.showsKeySignature).toBe(true)
            expect(score.measures[2].keySignature.fifths).toBe(2)
            expect(score.measures[2].layout.showsKeySignature).toBe(false)
        })

        it('a time signature change in beat amount or beat type shows the time signature', () => {
            const score = makeScore(3)
            score.measures[1].setTimeSignature(new TimeSignature(3, 4)) // beat amount changes
            score.measures[2].setTimeSignature(new TimeSignature(3, 8)) // beat type changes
            expect(score.measures[1].layout.showsTimeSignature).toBe(true)
            expect(score.measures[2].layout.showsTimeSignature).toBe(true)
        })

        it('a row start forces clef and key but not the time signature', () => {
            const score = makeScore(5)
            const rowStart = score.layout.rows[1].measures[0]
            expect(rowStart.layout.showsClef).toBe(true)
            expect(rowStart.layout.showsKeySignature).toBe(true)
            expect(rowStart.layout.showsTimeSignature).toBe(false)
        })
    })

    describe('reuse across rebuilds (identity stability for React memo)', () => {
        it('reuses rows and untouched measure layouts when a mutation changes no geometry', () => {
            const score = makeScore(8) // 2 rows of 4
            const before = score.layout
            // Replace a rest with an equally wide pitched quarter (both 26px) in measure 4.
            const m4 = score.measures[4]
            const target = m4.firstNote
            if (!target) throw new Error('expected a note')
            score.replace([target], [pitched('G', 4, 'q')])
            const after = score.layout
            expect(after).not.toBe(before)
            // Same widths everywhere → both rows are reused as-is.
            expect(after.rows[0]).toBe(before.rows[0])
            expect(after.rows[1]).toBe(before.rows[1])
            // The touched measure gets a fresh layout; every other measure keeps its instance.
            expect(after.measureLayoutFor(m4)).not.toBe(before.measureLayoutFor(m4))
            for (const m of score.measures) {
                if (m === m4) continue
                expect(after.measureLayoutFor(m)).toBe(before.measureLayoutFor(m))
            }
        })

        it('rebuilds the row and both measure layouts when a mutation changes widths', () => {
            const score = makeScore(2)
            const before = score.layout
            const m0 = score.measures[0]
            const m1 = score.measures[1]
            m0.addNotes(distinctSharps(8)) // widens m0 past the 200 floor → row re-spaces
            const after = score.layout
            expect(after.rows[0]).not.toBe(before.rows[0])
            expect(after.measureLayoutFor(m0)).not.toBe(before.measureLayoutFor(m0))
            // m1's content is untouched but its x shifted, so its layout is rebuilt too.
            expect(after.measureLayoutFor(m1)).not.toBe(before.measureLayoutFor(m1))
        })

        it('builds new rows when the packing gains a row', () => {
            const score = makeScore(4) // one full row
            const before = score.layout
            expect(before.rows).toHaveLength(1)
            score.addMeasure().complete() // fifth measure spills onto a new row
            const after = score.layout
            expect(after.rows).toHaveLength(2)
            expect(after.rows[1].index).toBe(1)
        })
    })

    describe('ties', () => {
        /** Turn the first rest of `measure` into two tied half notes and return the tie-starting note. */
        function tieWithin(score: Score, measure: Measure): Note {
            const target = measure.firstNote
            if (!target) throw new Error('expected a note')
            const half = (tie: 'start' | 'stop') =>
                new Note({ duration: new Duration({ type: 'h' }), pitch: new Pitch({ name: 'C', octave: 4 }), tie })
            const [start] = score.replace([target], [half('start'), half('stop')])
            return start
        }

        it('builds one TieLayout per semantic tie pairing', () => {
            const score = makeScore(8)
            const start = tieWithin(score, score.measures[0])
            expect(score.layout.ties).toHaveLength(1)
            expect(score.layout.ties[0].note).toBe(start)
            expect(score.layout.ties[0].nextNote).toBe(score.tiePartner(start))
        })

        it('reuses the tie instance when an unrelated row changes', () => {
            const score = makeScore(8)
            tieWithin(score, score.measures[0])
            const before = score.layout
            score.measures[7].setEndBarline('double') // row 1 only
            const after = score.layout
            expect(after.ties[0]).toBe(before.ties[0])
        })

        it('rebuilds the tie when its own row re-spaces', () => {
            const score = makeScore(8)
            tieWithin(score, score.measures[0])
            const before = score.layout
            score.measures[1].addNotes(distinctSharps(8)) // same row as the tie → m0 shrinks
            const after = score.layout
            expect(after.ties[0]).not.toBe(before.ties[0])
            expect(after.ties[0].note).toBe(before.ties[0].note) // same semantic tie, new geometry
        })
    })
})
