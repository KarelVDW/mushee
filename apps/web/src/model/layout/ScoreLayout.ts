import {
    BARLINE_GAP,
    BARLINE_THICK_WIDTH,
    BARLINE_THIN_WIDTH,
    CLEF_CONFIG,
    CLEF_TIME_SIG_PADDING,
    MAX_MEASURES_PER_ROW,
    MEASURE_BUTTONS_WIDTH,
    ROW_GAP,
    ROW_HEIGHT,
    SCORE_WIDTH,
    STAVE_LEFT_PADDING,
    STAVE_RIGHT_PADDING,
    TIME_SIG_NOTE_PADDING,
} from '@/components/notation/constants'
import { getGlyphWidth } from '@/components/notation/glyph-utils'
import type { BarlineType } from '@/components/notation/types'

import type { Measure } from '../Measure'
import type { Score } from '../Score'
import { RowLayout } from './RowLayout'

interface MeasurePosition {
    x: number
    width: number
    clefOverride?: string
}

export class ScoreLayout {
    readonly id = crypto.randomUUID()
    readonly scoreWidth: number
    readonly rowGap: number
    readonly rowHeight: number
    readonly maxMeasuresPerRow: number
    private _positions?: Map<number, MeasurePosition>
    private _rows?: RowLayout[]

    constructor(private score: Score) {
        this.scoreWidth = SCORE_WIDTH
        this.rowGap = ROW_GAP
        this.rowHeight = ROW_HEIGHT
        this.maxMeasuresPerRow = MAX_MEASURES_PER_ROW
    }

    // ── Position computation (eager, cached) ──────────────────────────

    private ensurePositions() {
        if (this._positions) return
        this._positions = new Map()
        this._rows = []

        const reserveLastRowWidth = MEASURE_BUTTONS_WIDTH
        let lastClef: string | undefined

        for (let i = 0; i < this.score.measures.length; i += this.maxMeasuresPerRow) {
            const rowMeasures = this.score.measures.slice(i, i + this.maxMeasuresPerRow)
            const isLastRow = i + this.maxMeasuresPerRow >= this.score.measures.length

            const rowWidth = Math.round(this.scoreWidth * (rowMeasures.length / this.maxMeasuresPerRow))
            const layoutWidth = isLastRow && reserveLastRowWidth > 0 ? rowWidth - reserveLastRowWidth : rowWidth

            // Determine clef overrides for this row
            const clefOverrides: (string | undefined)[] = rowMeasures.map((m, mi) => {
                return mi === 0 && i > 0 && !m.clef ? lastClef : undefined
            })

            const overheads = rowMeasures.map((m, mi) => {
                let overhead = STAVE_LEFT_PADDING
                const effectiveClef = clefOverrides[mi] || m.clef?.type
                if (effectiveClef) {
                    const config = CLEF_CONFIG[effectiveClef]
                    if (config) overhead += getGlyphWidth(config.glyphName) + CLEF_TIME_SIG_PADDING
                }
                if (m.timeSignature) {
                    const ts = m.timeSignature
                    const topW = ts.beatsDigits.reduce((s, d) => s + getGlyphWidth(`timeSig${d}`), 0)
                    const botW = ts.beatTypeDigits.reduce((s, d) => s + getGlyphWidth(`timeSig${d}`), 0)
                    overhead += Math.max(topW, botW) + TIME_SIG_NOTE_PADDING
                }
                overhead += STAVE_RIGHT_PADDING
                return overhead
            })

            const beats = rowMeasures.map((m) => Math.max(m.beats, 1))
            const barlineWidths = rowMeasures.map((m) => this.getBarlineWidth(m.endBarline ?? 'single'))
            const openingBarlineW = BARLINE_THIN_WIDTH

            const totalOverhead = overheads.reduce((a, b) => a + b, 0)
            const totalBarlineW = openingBarlineW + barlineWidths.reduce((a, b) => a + b, 0)
            const totalBeats = beats.reduce((a, b) => a + b, 0)
            const availableNoteWidth = Math.max(0, layoutWidth - totalOverhead - totalBarlineW)

            let cursorX = openingBarlineW
            for (let mi = 0; mi < rowMeasures.length; mi++) {
                const noteWidth = (beats[mi] / totalBeats) * availableNoteWidth
                const measureWidth = overheads[mi] + noteWidth

                this._positions.set(rowMeasures[mi].index, {
                    x: cursorX,
                    width: measureWidth,
                    clefOverride: clefOverrides[mi],
                })

                cursorX += measureWidth + barlineWidths[mi]
            }

            this._rows.push(new RowLayout(rowMeasures, layoutWidth, this._positions))

            for (const m of rowMeasures) {
                if (m.clef) lastClef = m.clef.type
            }
        }
    }

    // ── Public accessors (used by MeasureLayout) ──────────────────────

    getMeasureX(measure: Measure): number {
        this.ensurePositions()
        return this._positions?.get(measure.index)?.x ?? 0
    }

    getMeasureWidth(measure: Measure): number {
        this.ensurePositions()
        return this._positions?.get(measure.index)?.width ?? 0
    }

    getClefOverride(measure: Measure): string | undefined {
        this.ensurePositions()
        return this._positions?.get(measure.index)?.clefOverride
    }

    // ── Row structure ─────────────────────────────────────────────────

    get rows(): RowLayout[] {
        this.ensurePositions()
        return this._rows ?? []
    }

    get totalHeight() {
        const rowCount = Math.ceil(this.score.measures.length / (this.maxMeasuresPerRow ?? 4))
        return rowCount * this.rowHeight + Math.max(0, rowCount - 1) * this.rowGap
    }

    // ── Barline width helper ──────────────────────────────────────────

    private getBarlineWidth(type: BarlineType): number {
        switch (type) {
            case 'none':
                return 0
            case 'single':
                return BARLINE_THIN_WIDTH
            case 'double':
                return BARLINE_THIN_WIDTH + BARLINE_GAP + BARLINE_THIN_WIDTH
            case 'end':
                return BARLINE_THIN_WIDTH + BARLINE_GAP + BARLINE_THICK_WIDTH
        }
    }
}
