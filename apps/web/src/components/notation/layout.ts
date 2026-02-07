import {
  CLEF_TIME_SIG_PADDING,
  LEDGER_LINE_EXTENSION,
  NUM_STAFF_LINES,
  SPACE_ABOVE_STAFF,
  STAVE_LEFT_PADDING,
  STAVE_LINE_DISTANCE,
  STAVE_RIGHT_PADDING,
  STEM_HEIGHT,
  TIME_SIG_NOTE_PADDING,
} from './constants'
import { getGlyphWidth } from './glyph-utils'
import {
  accidentalGlyphName,
  durationToBeats,
  getLedgerLinePositions,
  getYForLine,
  getYForNote,
  noteheadForDuration,
  parseKey,
  pitchToLine,
} from './note-utils'
import type { LayoutGlyph, LayoutLine, LayoutNote, LayoutResult, LayoutStave, LayoutTimeSignature, ScoreInput, StaveInput } from './types'

/** Clef glyph placement: which staff line the glyph anchors to */
const CLEF_CONFIG: Record<string, { glyphName: string; lineIndex: number }> = {
    treble: { glyphName: 'gClef', lineIndex: 3 },
}

/**
 * Compute the full layout for a score.
 * Returns pre-computed positions for every visual element.
 */
export function computeLayout(input: ScoreInput, width: number = 600, height: number = 160): LayoutResult {
    const staves = input.staves.map((staveInput, idx) => computeStaveLayout(staveInput, width, idx))

    return { width, height, staves }
}

function computeStaveLayout(input: StaveInput, totalWidth: number, _staveIndex: number): LayoutStave {
    const staveX = 0
    const staveY = 0
    const staveWidth = totalWidth
    const headroom = SPACE_ABOVE_STAFF * STAVE_LINE_DISTANCE

    // 1. Staff lines
    const staffLines: LayoutLine[] = []
    for (let i = 0; i < NUM_STAFF_LINES; i++) {
        const y = staveY + headroom + i * STAVE_LINE_DISTANCE
        staffLines.push({ x1: staveX, y1: y, x2: staveX + staveWidth, y2: y })
    }

    // 2. Track horizontal cursor for modifiers
    let cursorX = staveX + STAVE_LEFT_PADDING

    // 3. Clef
    let clef: LayoutGlyph | undefined
    if (input.clef) {
        const config = CLEF_CONFIG[input.clef]
        if (config) {
            const clefY = getYForLine(config.lineIndex, staveY)
            clef = { glyphName: config.glyphName, x: cursorX, y: clefY }
            cursorX += getGlyphWidth(config.glyphName) + CLEF_TIME_SIG_PADDING
        }
    }

    // 4. Time signature
    let timeSignature: LayoutTimeSignature | undefined
    if (input.timeSignature) {
        const [topStr, bottomStr] = input.timeSignature.split('/')
        const tsX = cursorX

        // Top digits: centered between lines 0 and 1 → anchor at line 1
        // Bottom digits: centered between lines 2 and 3 → anchor at line 3
        const topY = getYForLine(1, staveY)
        const bottomY = getYForLine(3, staveY)

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

        timeSignature = { top: topDigits, bottom: bottomDigits }

        // Advance cursor past the widest line
        const topWidth = topDigits.reduce((sum, d) => sum + getGlyphWidth(d.glyphName), 0)
        const bottomWidth = bottomDigits.reduce((sum, d) => sum + getGlyphWidth(d.glyphName), 0)
        cursorX += Math.max(topWidth, bottomWidth) + TIME_SIG_NOTE_PADDING
    }

    // 5. Compute note positions
    const notesStartX = cursorX
    const notesEndX = staveX + staveWidth - STAVE_RIGHT_PADDING
    const availableWidth = notesEndX - notesStartX

    // Collect all unique beat positions across all voices
    const beatPositions = new Set<number>()
    for (const voice of input.voices) {
        let beat = 0
        for (const note of voice.notes) {
            beatPositions.add(beat)
            beat += durationToBeats(note.duration)
        }
    }

    const sortedBeats = Array.from(beatPositions).sort((a, b) => a - b)
    const numPositions = sortedBeats.length

    // Map each beat to an x position (equal spacing)
    const beatToX = new Map<number, number>()
    for (let i = 0; i < numPositions; i++) {
        const x = notesStartX + (i / Math.max(numPositions - 1, 1)) * availableWidth * 0.85 + availableWidth * 0.05
        beatToX.set(sortedBeats[i], x)
    }

    // 6. Layout each note in each voice
    const noteheadWidth = getGlyphWidth('noteheadBlack')
    const notes: LayoutNote[] = []

    for (const voice of input.voices) {
        const stemDir = voice.stem ?? 'auto'
        let beat = 0

        for (const noteInput of voice.notes) {
            // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
            const x = beatToX.get(beat)!

            for (const key of noteInput.keys) {
                const { accidental } = parseKey(key)
                const noteLine = pitchToLine(key, input.clef)
                const noteY = getYForNote(noteLine, staveY)
                const glyphName = noteheadForDuration(noteInput.duration)

                // Accidental
                let accidentalLayout: LayoutGlyph | undefined
                if (accidental) {
                    const accGlyph = accidentalGlyphName(accidental)
                    if (accGlyph) {
                        const accWidth = getGlyphWidth(accGlyph)
                        accidentalLayout = {
                            glyphName: accGlyph,
                            x: x - accWidth - 2,
                            y: noteY,
                        }
                    }
                }

                // Stem
                let stem: LayoutNote['stem']
                if (noteInput.duration !== 'w') {
                    const dir = stemDir === 'auto' ? (noteLine >= 3 ?  'down' : 'up') : stemDir

                    if (dir === 'up') {
                        // Stem on right side of notehead, going up
                        stem = {
                            x: x + noteheadWidth,
                            y1: noteY,
                            y2: noteY - STEM_HEIGHT,
                        }
                    } else {
                        // Stem on left side of notehead, going down
                        stem = {
                            x: x,
                            y1: noteY,
                            y2: noteY + STEM_HEIGHT,
                        }
                    }
                }

                // Ledger lines
                const ledgerLineYs = getLedgerLinePositions(noteLine, staveY)
                const ledgerLines: LayoutLine[] = ledgerLineYs.map((ly) => ({
                    x1: x - LEDGER_LINE_EXTENSION,
                    y1: ly,
                    x2: x + noteheadWidth + LEDGER_LINE_EXTENSION,
                    y2: ly,
                }))

                notes.push({
                    x,
                    y: noteY,
                    glyphName,
                    accidental: accidentalLayout,
                    stem,
                    ledgerLines,
                })
            }

            beat += durationToBeats(noteInput.duration)
        }
    }

    return {
        x: staveX,
        y: staveY,
        width: staveWidth,
        staffLines,
        clef,
        timeSignature,
        notes,
    }
}
