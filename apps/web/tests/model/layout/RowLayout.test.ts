import { makeScore } from '@test/helpers'
import { describe, expect, it } from 'vitest'

import {
    MAX_MEASURES_PER_ROW,
    MEASURE_BUTTON_SPACING,
    NUM_STAFF_LINES,
    SCORE_WIDTH,
    SPACE_ABOVE_STAFF,
    STAVE_LINE_DISTANCE,
} from '@/components/notation/constants'
import { RowLayout, type RowLayoutContext } from '@/model/layout/RowLayout'
import { Measure } from '@/model/Measure'
import { Score } from '@/model/Score'
import { TimeSignature } from '@/model/TimeSignature'

/** A bare measure (RowLayout only uses measures as identities + minimal-width keys). */
function bareMeasure(): Measure {
    return new Measure(new Score(), 'treble', new TimeSignature(4, 4))
}

function context(measures: Measure[], widths: number[], overrides?: Partial<RowLayoutContext>): RowLayoutContext {
    return {
        index: 0,
        isLastRow: true,
        measures,
        minimalWidths: new Map(measures.map((m, i) => [m, widths[i]])),
        scoreWidth: SCORE_WIDTH,
        ...overrides,
    }
}

describe('RowLayout', () => {
    it('a non-last row stretches to the full score width', () => {
        const score = makeScore(MAX_MEASURES_PER_ROW + 1)
        expect(score.layout.rows[0].isLastRow).toBe(false)
        expect(score.layout.rows[0].width).toBe(SCORE_WIDTH)
    })

    it('a full last row stretches to the score width minus the button reserve', () => {
        const score = makeScore(3)
        const row = score.layout.rows[0]
        expect(row.isLastRow).toBe(true)
        expect(row.width).toBe(SCORE_WIDTH - MEASURE_BUTTON_SPACING)
    })

    it('an incomplete last row (≤2 measures) keeps natural widths instead of stretching', () => {
        const score = makeScore(1)
        const row = score.layout.rows[0]
        // One near-empty measure at the default width: budget / MAX_MEASURES_PER_ROW.
        expect(row.width).toBeCloseTo((SCORE_WIDTH - MEASURE_BUTTON_SPACING) / MAX_MEASURES_PER_ROW)
        expect(row.width).toBeLessThan(SCORE_WIDTH - MEASURE_BUTTON_SPACING)
    })

    it('measures tile the row: each x is the previous x plus its width', () => {
        const score = makeScore(MAX_MEASURES_PER_ROW)
        const row = score.layout.rows[0]
        let cursor = 0
        for (const m of row.measures) {
            expect(row.getMeasureX(m)).toBeCloseTo(cursor)
            cursor += row.getMeasureWidth(m)
        }
        expect(cursor).toBeCloseTo(row.width)
    })

    it('getMeasureX and getMeasureWidth throw for a measure not in this row', () => {
        const score = makeScore(MAX_MEASURES_PER_ROW + 1)
        const row0 = score.layout.rows[0]
        const otherRowMeasure = score.layout.rows[1].measures[0]
        expect(() => row0.getMeasureX(otherRowMeasure)).toThrow('Measure not in this row')
        expect(() => row0.getMeasureWidth(otherRowMeasure)).toThrow('Measure not in this row')
    })

    it('getMeasureForX returns the measure whose span contains x, or null outside the row', () => {
        const score = makeScore(2)
        const row = score.layout.rows[0]
        const [m0, m1] = row.measures
        expect(row.getMeasureForX(0)).toBe(m0)
        expect(row.getMeasureForX(row.getMeasureX(m1) + 1)).toBe(m1)
        expect(row.getMeasureForX(-1)).toBeNull()
        expect(row.getMeasureForX(row.width + 1)).toBeNull()
    })

    it('draws the staff lines across the full row width at the staff positions', () => {
        const score = makeScore(1)
        const row = score.layout.rows[0]
        const headroom = SPACE_ABOVE_STAFF * STAVE_LINE_DISTANCE
        expect(row.staffLines).toHaveLength(NUM_STAFF_LINES)
        row.staffLines.forEach((line, i) => {
            expect(line.y1).toBe(headroom + i * STAVE_LINE_DISTANCE)
            expect(line.y2).toBe(line.y1)
            expect(line.x1).toBe(0)
            expect(line.x2).toBe(row.width)
        })
    })

    it('draws a single opening barline spanning the staff at the left edge', () => {
        const score = makeScore(1)
        const bar = score.layout.rows[0].openingBarline
        expect(bar.x).toBe(0)
        expect(bar.y).toBe(SPACE_ABOVE_STAFF * STAVE_LINE_DISTANCE)
        expect(bar.height).toBe((NUM_STAFF_LINES - 1) * STAVE_LINE_DISTANCE)
        expect(bar.type).toBe('single')
    })

    it('a measure without a registered minimal width is allotted the plain default', () => {
        const m = bareMeasure()
        const row = new RowLayout({ index: 0, isLastRow: true, measures: [m], minimalWidths: new Map(), scoreWidth: SCORE_WIDTH })
        expect(row.getMeasureWidth(m)).toBeCloseTo((SCORE_WIDTH - MEASURE_BUTTON_SPACING) / MAX_MEASURES_PER_ROW)
    })

    describe('matches (reuse check across ScoreLayout rebuilds)', () => {
        const a = bareMeasure()
        const b = bareMeasure()
        const ctx = context([a, b], [200, 250])
        const row = new RowLayout(ctx)

        it('matches an identical context', () => {
            expect(row.matches(context([a, b], [200, 250]))).toBe(true)
        })

        it('rejects a different row index', () => {
            expect(row.matches(context([a, b], [200, 250], { index: 1 }))).toBe(false)
        })

        it('rejects a flipped isLastRow', () => {
            expect(row.matches(context([a, b], [200, 250], { isLastRow: false }))).toBe(false)
        })

        it('rejects a different measure count', () => {
            expect(row.matches(context([a], [200]))).toBe(false)
        })

        it('rejects different measure identities', () => {
            expect(row.matches(context([a, bareMeasure()], [200, 250]))).toBe(false)
        })

        it('rejects a changed minimal width', () => {
            expect(row.matches(context([a, b], [200, 300]))).toBe(false)
        })

        it('rejects a changed score width (responsive reflow)', () => {
            expect(row.matches(context([a, b], [200, 250], { scoreWidth: 500 }))).toBe(false)
        })
    })
})
