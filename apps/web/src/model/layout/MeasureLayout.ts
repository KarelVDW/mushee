import { getGlyphWidth, getYForLine } from '@/components/notation'
import { CLEF_TIME_SIG_PADDING, STAVE_LEFT_PADDING, STAVE_RIGHT_PADDING, TIME_SIG_NOTE_PADDING } from '@/components/notation/constants'
import type { LayoutGlyph, LayoutTimeSignature } from '@/components/notation/types'

import type { Measure } from '../Measure'

const CLEF_CONFIG: Record<string, { glyphName: string; lineIndex: number }> = {
    treble: { glyphName: 'gClef', lineIndex: 3 },
}

export class MeasureLayout {
    constructor(readonly measure: Measure) {}

    get measureX() {
        return this.measure.score.layout.getMeasureX(this.measure)
    }

    get measureWidth() {
        return this.measure.score.layout.getMeasureWidth(this.measure)
    }

    get clefOverride() {
        return this.measure.score.layout.getClefOverride(this.measure)
    }

    get xOverhead() {
        let overhead = STAVE_LEFT_PADDING

        const effectiveClef = this.clefOverride || this.measure.clef
        if (effectiveClef) {
            const config = CLEF_CONFIG[effectiveClef]
            if (config) {
                overhead += getGlyphWidth(config.glyphName) + CLEF_TIME_SIG_PADDING
            }
        }

        if (this.measure.timeSignature) {
            const [topStr, bottomStr] = this.measure.timeSignature.split('/')
            const topWidth = topStr.split('').reduce((sum, d) => sum + getGlyphWidth(`timeSig${d}`), 0)
            const bottomWidth = bottomStr.split('').reduce((sum, d) => sum + getGlyphWidth(`timeSig${d}`), 0)
            overhead += Math.max(topWidth, bottomWidth) + TIME_SIG_NOTE_PADDING
        }

        overhead += STAVE_RIGHT_PADDING
        return overhead
    }

    /** X where notes start (after clef + time sig, before right padding) */
    private get notesStartX(): number {
        return this.measureX + this.xOverhead - STAVE_RIGHT_PADDING
    }

    get clef(): LayoutGlyph | undefined {
        const effectiveClef = this.clefOverride ?? this.measure.clef
        if (!effectiveClef) return
        const config = CLEF_CONFIG[effectiveClef]
        if (!config) return
        return { glyphName: config.glyphName, x: this.measureX + STAVE_LEFT_PADDING, y: getYForLine(config.lineIndex) }
    }

    get timeSignature(): LayoutTimeSignature | undefined {
        if (!this.measure.timeSignature) return

        let cursorX = this.measureX + STAVE_LEFT_PADDING
        const effectiveClef = this.clefOverride ?? this.measure.clef
        if (effectiveClef) {
            const config = CLEF_CONFIG[effectiveClef]
            if (config) cursorX += getGlyphWidth(config.glyphName) + CLEF_TIME_SIG_PADDING
        }

        const [topStr, bottomStr] = this.measure.timeSignature.split('/')
        const tsX = cursorX
        const topY = getYForLine(1)
        const bottomY = getYForLine(3)

        const topDigits = topStr.split('').map((digit, i) => ({
            glyphName: `timeSig${digit}`,
            x: tsX + i * getGlyphWidth(`timeSig${digit}`),
            y: topY,
        }))
        const bottomDigits = bottomStr.split('').map((digit, i) => ({
            glyphName: `timeSig${digit}`,
            x: tsX + i * getGlyphWidth(`timeSig${digit}`),
            y: bottomY,
        }))

        return { top: topDigits, bottom: bottomDigits }
    }

    getX(beat: number) {
        const notesStartX = this.notesStartX
        const notesEndX = this.measureX + this.measureWidth - STAVE_RIGHT_PADDING
        const availableWidth = notesEndX - notesStartX
        const totalBeats = Math.max(this.measure.beats, 1)
        return notesStartX + (beat / totalBeats) * availableWidth
    }
}
