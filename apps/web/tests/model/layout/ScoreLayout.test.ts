import { describe, expect, it } from 'vitest'

import { ROW_GAP, ROW_HEIGHT, SCORE_WIDTH } from '@/components/notation/constants'
import { makeScore } from '@test/helpers'

describe('ScoreLayout', () => {
    it('exposes constants', () => {
        const score = makeScore(1)
        expect(score.layout.scoreWidth).toBe(SCORE_WIDTH)
        expect(score.layout.rowGap).toBe(ROW_GAP)
        expect(score.layout.rowHeight).toBe(ROW_HEIGHT)
    })

    it('totalHeight is rowCount × rowHeight + gaps', () => {
        const score = makeScore(8) // 8 measures → 2 rows
        expect(score.rows.length).toBe(2)
        expect(score.layout.totalHeight).toBe(2 * ROW_HEIGHT + ROW_GAP)
    })

    it('totalHeight is 0 for an empty score', () => {
        const score = makeScore(0)
        expect(score.layout.totalHeight).toBe(0)
    })

    it('getYForRow returns row.index × (rowHeight + rowGap)', () => {
        const score = makeScore(8)
        const r0 = score.rows[0]
        const r1 = score.rows[1]
        expect(score.layout.getYForRow(r0)).toBe(0)
        expect(score.layout.getYForRow(r1)).toBe(ROW_HEIGHT + ROW_GAP)
    })

    it('getRowForY: y=0 returns first row, y in second band returns second row', () => {
        const score = makeScore(8)
        expect(score.layout.getRowForY(0)).toBe(score.rows[0])
        expect(score.layout.getRowForY(ROW_HEIGHT + ROW_GAP + 1)).toBe(score.rows[1])
    })
})
