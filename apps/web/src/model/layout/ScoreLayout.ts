import { ROW_GAP, ROW_HEIGHT, SCORE_WIDTH } from '@/components/notation/constants'

import { Row } from '../Row'
import type { Score } from '../Score'

export class ScoreLayout {
    readonly id = crypto.randomUUID()
    readonly scoreWidth = SCORE_WIDTH
    readonly rowGap = ROW_GAP
    readonly rowHeight = ROW_HEIGHT

    constructor(private score: Score) {}

    get totalHeight() {
        const rowCount = this.score.rows.length
        return rowCount * this.rowHeight + Math.max(0, rowCount - 1) * this.rowGap
    }

    getYForRow(row: Row) {
        return row.index * (this.rowHeight + this.rowGap)
    }

    getRowForY(y: number) {
        return this.score.rows[Math.floor(y / (this.rowHeight + this.rowGap))]
    }
}
