import { NUM_STAFF_LINES, SPACE_ABOVE_STAFF, STAVE_LINE_DISTANCE } from '@/components/notation/constants'
import type { LayoutBarline, LayoutLine } from '@/components/notation/types'

import type { Measure } from '../Measure'

export class RowLayout {
    readonly id = crypto.randomUUID()
    constructor(
        readonly measures: Measure[],
        readonly width: number,
        private positions: Map<number, { x: number; width: number }>,
    ) {}

    get staffLines(): LayoutLine[] {
        const headroom = SPACE_ABOVE_STAFF * STAVE_LINE_DISTANCE
        const lines: LayoutLine[] = []
        for (let i = 0; i < NUM_STAFF_LINES; i++) {
            const y = headroom + i * STAVE_LINE_DISTANCE
            lines.push({ x1: 0, y1: y, x2: this.width, y2: y })
        }
        return lines
    }

    get barlines(): LayoutBarline[] {
        const headroom = SPACE_ABOVE_STAFF * STAVE_LINE_DISTANCE
        const staffHeight = (NUM_STAFF_LINES - 1) * STAVE_LINE_DISTANCE

        const barlines: LayoutBarline[] = [{ x: 0, y: headroom, height: staffHeight, type: 'single' }]
        for (const m of this.measures) {
            const pos = this.positions.get(m.index)
            if (pos) {
                barlines.push({
                    x: pos.x + pos.width,
                    y: headroom,
                    height: staffHeight,
                    type: m.endBarline ?? 'single',
                })
            }
        }
        return barlines
    }

}
