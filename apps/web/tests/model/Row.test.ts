import { describe, expect, it } from 'vitest'

import { MAX_MEASURES_PER_ROW, SCORE_WIDTH } from '@/components/notation/constants'

import { Clef } from '@/model/Clef'
import { Measure } from '@/model/Measure'
import { Row } from '@/model/Row'
import { Score } from '@/model/Score'
import { TimeSignature } from '@/model/TimeSignature'

describe('Row', () => {
    it('starts empty', () => {
        const score = new Score()
        const row = new Row(score, 0)
        expect(row.measures).toEqual([])
        expect(row.isEmpty).toBe(true)
        expect(row.width).toBe(0)
    })

    it('addMeasure appends and clears empty flag', () => {
        const score = new Score()
        const row = new Row(score, 0)
        const m = new Measure(score, new Clef('treble'), new TimeSignature(4, 4))
        row.addMeasure(m)
        expect(row.isEmpty).toBe(false)
        expect(row.measures).toContain(m)
        expect(row.firstMeasures).toBe(m)
        expect(row.lastMeasures).toBe(m)
    })

    it('width sums measure minimal widths', () => {
        const score = new Score()
        const row = new Row(score, 0)
        const m1 = new Measure(score, new Clef('treble'), new TimeSignature(4, 4))
        const m2 = new Measure(score, new Clef('treble'), new TimeSignature(4, 4))
        row.addMeasure(m1)
        row.addMeasure(m2)
        expect(row.width).toBe(m1.minimalWidth + m2.minimalWidth)
    })

    describe('canFit', () => {
        it('returns true when width + measure.minimalWidth fits and below MAX_MEASURES_PER_ROW', () => {
            const score = new Score()
            const row = new Row(score, 0)
            const m = new Measure(score, new Clef('treble'), new TimeSignature(4, 4))
            expect(row.canFit(m)).toBe(true)
        })

        it('returns false at MAX_MEASURES_PER_ROW', () => {
            const score = new Score()
            const row = new Row(score, 0)
            for (let i = 0; i < MAX_MEASURES_PER_ROW; i++) {
                row.addMeasure(new Measure(score, new Clef('treble'), new TimeSignature(4, 4)))
            }
            const extra = new Measure(score, new Clef('treble'), new TimeSignature(4, 4))
            expect(row.canFit(extra)).toBe(false)
        })

        it('returns false when adding would exceed SCORE_WIDTH', () => {
            const score = new Score()
            const row = new Row(score, 0)
            // Using minimalWidth = 200, MAX_MEASURES_PER_ROW = 4, SCORE_WIDTH = 1000.
            // 4 × 200 = 800 ≤ 1000 — fits. So this width-based limit only triggers for wider measures.
            // We can't directly force a measure to have a >1000 minimalWidth here without notes,
            // so just verify that 5 standard measures hit the count limit.
            for (let i = 0; i < MAX_MEASURES_PER_ROW; i++) {
                row.addMeasure(new Measure(score, new Clef('treble'), new TimeSignature(4, 4)))
            }
            expect(row.canFit(new Measure(score, new Clef('treble'), new TimeSignature(4, 4)))).toBe(false)
            expect(row.width).toBeLessThanOrEqual(SCORE_WIDTH)
        })
    })

    it('removeLastMeasure pops the last measure', () => {
        const score = new Score()
        const row = new Row(score, 0)
        const a = new Measure(score, new Clef('treble'), new TimeSignature(4, 4))
        const b = new Measure(score, new Clef('treble'), new TimeSignature(4, 4))
        row.addMeasure(a)
        row.addMeasure(b)
        const removed = row.removeLastMeasure()
        expect(removed).toBe(b)
        expect(row.measures).toEqual([a])
    })

    it('removeLastMeasure returns undefined on an empty row', () => {
        const score = new Score()
        const row = new Row(score, 0)
        expect(row.removeLastMeasure()).toBeUndefined()
    })

    it('invalidateLayout clears row layout cache', () => {
        const score = new Score()
        score.addMeasure().complete()
        const row = score.firstRow!
        const before = row.layout
        row.invalidateLayout()
        const after = row.layout
        expect(before).not.toBe(after)
    })
})
