import { sum, sumBy } from 'lodash-es'

import type { BeamGroup } from '@/model'
import { Measure, Note, Score } from '@/model'

import {
    BARLINE_GAP,
    BARLINE_THICK_WIDTH,
    BARLINE_THIN_WIDTH,
    BEAM_LEVEL_STRIDE,
    BEAM_MAX_SLOPE,
    BEAM_WIDTH,
    CLEF_TIME_SIG_PADDING,
    DOT_NOTEHEAD_OFFSET,
    DOT_SPACING,
    LEDGER_LINE_EXTENSION,
    NUM_STAFF_LINES,
    PARTIAL_BEAM_LENGTH,
    SPACE_ABOVE_STAFF,
    STAVE_LEFT_PADDING,
    STAVE_LINE_DISTANCE,
    STAVE_RIGHT_PADDING,
    STEM_HEIGHT,
    TEMPO_MARKING_Y,
    TIME_SIG_NOTE_PADDING,
    TUPLET_NUMBER_SCALE,
    TUPLET_OFFSET,
} from './constants'
import { getGlyphWidth } from './glyph-utils'
import { getLedgerLinePositions, getYForLine, getYForNote } from './note-utils'
import type {
    BarlineType,
    LayoutBarline,
    LayoutBeamSegment,
    LayoutGlyph,
    LayoutLine,
    LayoutMeasure,
    LayoutNote,
    LayoutResult,
    LayoutTempoMarking,
    LayoutTie,
    LayoutTimeSignature,
    LayoutTuplet,
    ScoreLayout,
} from './types'

/** Clef glyph placement: which staff line the glyph anchors to */
const CLEF_CONFIG: Record<string, { glyphName: string; lineIndex: number }> = {
    treble: { glyphName: 'gClef', lineIndex: 3 },
}

/** Internal note with layout info, used during beam computation */
interface NoteLayout {
    note: LayoutNote
    input: Note
    stemDir: 'up' | 'down'
    beat: number
    tupletGroup: Set<Note> | undefined // reference to the measure's tuplet set this note belongs to
    isRest: boolean
}

/** Width of a barline type in pixels */
function barlineWidth(type: BarlineType): number {
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

export interface ScoreLayoutOptions {
    maxMeasuresPerRow?: number
    rowGap?: number
    reserveLastRowWidth?: number
}

export function computeLayout(
    score: Score,
    containerWidth: number,
    rowHeight: number = 160,
    options?: ScoreLayoutOptions,
): ScoreLayout {
    const maxPerRow = options?.maxMeasuresPerRow ?? 4
    const rowGap = options?.rowGap ?? 16
    const reserveWidth = options?.reserveLastRowWidth ?? 0

    if (score.measures.length === 0 || containerWidth <= 0) {
        return { rows: [], totalHeight: 0, rowHeight, rowGap }
    }

    const rows: LayoutResult[] = []
    let lastClef: string | undefined

    for (let i = 0; i < score.measures.length; i += maxPerRow) {
        const rowMeasures = score.measures.slice(i, i + maxPerRow)
        const isLastRow = i + maxPerRow >= score.measures.length

        const rowWidth = Math.round(containerWidth * (rowMeasures.length / maxPerRow))
        const layoutWidth = isLastRow && reserveWidth > 0 ? rowWidth - reserveWidth : rowWidth

        const inheritedClef = i > 0 && !rowMeasures[0].clef ? lastClef : undefined

        const layout = computeRowLayout(rowMeasures, layoutWidth, rowHeight, i, inheritedClef)
        rows.push(layout)

        for (const m of rowMeasures) {
            if (m.clef) lastClef = m.clef
        }
    }

    const totalHeight = rows.length * rowHeight + Math.max(0, rows.length - 1) * rowGap

    return { rows, totalHeight, rowHeight, rowGap }
}

function computeRowLayout(
    measures: Measure[],
    width: number = 600,
    height: number = 160,
    measureIndexOffset: number = 0,
    inheritedClef?: string,
): LayoutResult {
    const staveY = 0
    const headroom = SPACE_ABOVE_STAFF * STAVE_LINE_DISTANCE

    // 1. Continuous staff lines across full width
    const staffLines: LayoutLine[] = []
    for (let i = 0; i < NUM_STAFF_LINES; i++) {
        const y = staveY + headroom + i * STAVE_LINE_DISTANCE
        staffLines.push({ x1: 0, y1: y, x2: width, y2: y })
    }

    const staffTopY = staveY + headroom
    const staffHeight = (NUM_STAFF_LINES - 1) * STAVE_LINE_DISTANCE

    // 2. Compute overhead width for each measure (clef + time sig + padding)
    const measureOverheads: number[] = []
    const measureBeats: number[] = []

    for (let mi = 0; mi < measures.length; mi++) {
        const measure = measures[mi]
        let overhead = STAVE_LEFT_PADDING

        const effectiveClef = mi === 0 && inheritedClef && !measure.clef ? inheritedClef : measure.clef
        if (effectiveClef) {
            const config = CLEF_CONFIG[effectiveClef]
            if (config) {
                overhead += getGlyphWidth(config.glyphName) + CLEF_TIME_SIG_PADDING
            }
        }

        if (measure.timeSignature) {
            const [topStr, bottomStr] = measure.timeSignature.split('/')
            const topWidth = topStr.split('').reduce((sum, d) => sum + getGlyphWidth(`timeSig${d}`), 0)
            const bottomWidth = bottomStr.split('').reduce((sum, d) => sum + getGlyphWidth(`timeSig${d}`), 0)
            overhead += Math.max(topWidth, bottomWidth) + TIME_SIG_NOTE_PADDING
        }

        overhead += STAVE_RIGHT_PADDING
        measureOverheads.push(overhead)

        measureBeats.push(
            Math.max(
                sumBy(measure.notes, (n) => n.duration.effectiveBeats),
                1,
            ),
        )
    }

    // 3. Compute barline widths
    const barlineTypes: BarlineType[] = measures.map((m) => m.endBarline ?? 'single')
    const openingBarlineW = BARLINE_THIN_WIDTH
    const barlineWidths = barlineTypes.map(barlineWidth)

    // 4. Distribute remaining width proportionally by beats
    const totalOverhead = measureOverheads.reduce((a, b) => a + b, 0)
    const totalBarlineWidth = openingBarlineW + barlineWidths.reduce((a, b) => a + b, 0)
    const totalBeats = sum(measureBeats)
    const availableNoteWidth = Math.max(0, width - totalOverhead - totalBarlineWidth)

    // 5. Layout each measure
    let cursorX = 0
    let noteEventCounter = 0
    const layoutMeasures: LayoutMeasure[] = []
    const barlines: LayoutBarline[] = []

    // Opening barline
    barlines.push({
        x: cursorX,
        y: staffTopY,
        height: staffHeight,
        type: 'single',
    })
    cursorX += openingBarlineW

    for (let mi = 0; mi < measures.length; mi++) {
        const measureInput = measures[mi]
        const noteWidth = (measureBeats[mi] / totalBeats) * availableNoteWidth
        const measureWidth = measureOverheads[mi] + noteWidth
        const measureX = cursorX

        const clefOverride = mi === 0 && inheritedClef && !measureInput.clef ? inheritedClef : undefined
        const measureLayout = computeMeasureLayout(measureInput, measureX, measureWidth, staveY, noteEventCounter, measureIndexOffset + mi, clefOverride)
        noteEventCounter = measureLayout.nextNoteEventIndex
        layoutMeasures.push(measureLayout)

        cursorX += measureWidth

        // End barline
        barlines.push({
            x: cursorX,
            y: staffTopY,
            height: staffHeight,
            type: barlineTypes[mi],
        })
        cursorX += barlineWidths[mi]
    }

    const ties = computeTies(measures, layoutMeasures)
    const tempoMarkings = computeTempoMarkings(measures, layoutMeasures)

    return { width, height, staffLines, measures: layoutMeasures, barlines, ties, tempoMarkings, totalNoteEvents: noteEventCounter }
}

/**
 * Compute dot positions for a note or rest.
 * Dots are placed to the right of the notehead, shifted up by half a line
 * distance if the note sits on a staff line (to avoid dots landing on lines).
 */
function computeDotPositions(
    numDots: number | undefined,
    noteRightX: number,
    noteY: number,
    noteLine: number,
): { x: number; y: number }[] | undefined {
    if (!numDots || numDots <= 0) return undefined
    const dots: { x: number; y: number }[] = []

    // If the note sits on a line (integer noteLine), shift dots up by half a space
    const onLine = Number.isInteger(noteLine)
    const dotY = onLine ? noteY - STAVE_LINE_DISTANCE / 2 : noteY

    for (let i = 0; i < numDots; i++) {
        dots.push({
            x: noteRightX + DOT_NOTEHEAD_OFFSET + i * DOT_SPACING,
            y: dotY,
        })
    }

    return dots
}

function computeMeasureLayout(
    measure: Measure,
    measureX: number,
    measureWidth: number,
    staveY: number,
    noteEventIndex: number,
    globalMeasureIndex: number,
    clefOverride?: string,
): LayoutMeasure & { nextNoteEventIndex: number } {
    // 1. Clef
    let cursorX = measureX + STAVE_LEFT_PADDING
    let clef: LayoutGlyph | undefined
    const effectiveClef = clefOverride ?? measure.clef
    if (effectiveClef) {
        const config = CLEF_CONFIG[effectiveClef]
        if (config) {
            clef = { glyphName: config.glyphName, x: cursorX, y: getYForLine(config.lineIndex, staveY) }
            cursorX += getGlyphWidth(config.glyphName) + CLEF_TIME_SIG_PADDING
        }
    }

    // 2. Time signature
    let timeSignature: LayoutTimeSignature | undefined
    if (measure.timeSignature) {
        const [topStr, bottomStr] = measure.timeSignature.split('/')
        const tsX = cursorX
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

        const topWidth = topDigits.reduce((sum, d) => sum + getGlyphWidth(d.glyphName), 0)
        const bottomWidth = bottomDigits.reduce((sum, d) => sum + getGlyphWidth(d.glyphName), 0)
        cursorX += Math.max(topWidth, bottomWidth) + TIME_SIG_NOTE_PADDING
    }

    // 3. Beat → x mapping within this measure (with tuplet-adjusted beats)
    const notesStartX = cursorX
    const notesEndX = measureX + measureWidth - STAVE_RIGHT_PADDING
    const availableWidth = notesEndX - notesStartX

    const beatPositions = new Set<number>()
    let beat = 0
    for (const note of measure.notes) {
        beatPositions.add(beat)
        beat += note.duration.effectiveBeats
    }
    const sortedBeats = Array.from(beatPositions).sort((a, b) => a - b)
    const numPositions = sortedBeats.length
    const beatToX = new Map<number, number>()
    for (let i = 0; i < numPositions; i++) {
        const x = notesStartX + (i / Math.max(numPositions - 1, 1)) * availableWidth * 0.85 + availableWidth * 0.05
        beatToX.set(sortedBeats[i], x)
    }

    // 4. Beam groups and stem directions (pre-computed by the model)
    const beamGroups = measure.beamGroups
    const beamGroupByNote = new Map<Note, BeamGroup>()
    for (const group of beamGroups) {
        for (const note of group.notes) {
            beamGroupByNote.set(note, group)
        }
    }

    // 5. Layout notes (first pass — default stems, flags)
    const noteheadWidth = getGlyphWidth('noteheadBlack')
    const allNoteLayouts: NoteLayout[] = []
    beat = 0

    for (const note of measure.notes) {
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        const x = beatToX.get(beat)!
        const tupletGroup = measure.tuplets.find((s) => s.has(note))

        if (note.isRest) {
            // Rest: use rest glyph, default line, no stem/flag/accidental/ledger
            const rLine = note.duration.restLine
            const noteY = getYForNote(rLine, staveY)
            const glyphName = note.duration.restGlyph
            const dots = computeDotPositions(note.duration.dots, x + noteheadWidth, noteY, rLine)
            const layoutNote: LayoutNote = { x, y: noteY, glyphName, dots, ledgerLines: [], noteEventIndex, noteId: note.id }
            allNoteLayouts.push({
                note: layoutNote,
                input: note,
                stemDir: 'up',
                beat,
                tupletGroup,
                isRest: true,
            })
        } else {
            // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
            const pitch = note.pitch!
            const noteLine = pitch.line
            const noteY = getYForNote(noteLine, staveY)
            const glyphName = note.duration.noteheadGlyph
            // Use beam group stem direction if available, otherwise fall back to per-note logic
            const dir: 'up' | 'down' = beamGroupByNote.get(note)?.stemDir ?? (noteLine >= 3 ? 'down' : 'up')

            // Accidental
            let accidentalLayout: LayoutGlyph | undefined
            if (pitch.accidental) {
                const accGlyph = pitch.accidentalGlyph
                if (accGlyph) {
                    accidentalLayout = {
                        glyphName: accGlyph,
                        x: x - getGlyphWidth(accGlyph) - 2,
                        y: noteY,
                    }
                }
            }

            // Stem
            let stem: LayoutNote['stem']
            if (note.duration.type !== 'w') {
                stem =
                    dir === 'up'
                        ? { x: x + noteheadWidth, y1: noteY, y2: noteY - STEM_HEIGHT }
                        : { x: x, y1: noteY, y2: noteY + STEM_HEIGHT }
            }

            // Flag (will be suppressed for beamed notes in pass 2)
            let flag: LayoutGlyph | undefined
            const flagName = note.duration.flagGlyph(dir)
            if (flagName && stem) {
                flag = { glyphName: flagName, x: stem.x, y: stem.y2 }
            }

            // Ledger lines
            const ledgerLineYs = getLedgerLinePositions(noteLine, staveY)
            const ledgerLines: LayoutLine[] = ledgerLineYs.map((ly) => ({
                x1: x - LEDGER_LINE_EXTENSION,
                y1: ly,
                x2: x + noteheadWidth + LEDGER_LINE_EXTENSION,
                y2: ly,
            }))

            // Dots
            const dots = computeDotPositions(note.duration.dots, x + noteheadWidth, noteY, noteLine)

            const layoutNote: LayoutNote = {
                x,
                y: noteY,
                glyphName,
                accidental: accidentalLayout,
                stem,
                flag,
                dots,
                ledgerLines,
                noteEventIndex,
                noteId: note.id,
            }
            allNoteLayouts.push({
                note: layoutNote,
                input: note,
                stemDir: dir,
                beat,
                tupletGroup,
                isRest: false,
            })
        }

        noteEventIndex++
        beat += note.duration.effectiveBeats
    }

    // 6. For each beam group: compute slope, adjust stems, generate segments, suppress flags
    const noteLayoutByNote = new Map<Note, NoteLayout>()
    for (const nl of allNoteLayouts) {
        noteLayoutByNote.set(nl.input, nl)
    }
    const beams: LayoutBeamSegment[][] = []
    for (const group of beamGroups) {
        const groupLayouts: NoteLayout[] = []
        for (const note of group.notes) {
            const nl = noteLayoutByNote.get(note)
            if (nl) groupLayouts.push(nl)
        }
        beams.push(layoutBeamGroup(groupLayouts))
    }

    // 7. Compute tuplet bracket layouts
    const tuplets = computeTupletLayouts(measure, allNoteLayouts, noteheadWidth)

    return {
        x: measureX,
        width: measureWidth,
        clef,
        timeSignature,
        notes: allNoteLayouts.map((nl) => nl.note),
        beams,
        tuplets,
        nextNoteEventIndex: noteEventIndex,
    }
}

/**
 * Compute tuplet bracket layouts for all voices in a measure.
 */
function computeTupletLayouts(measure: Measure, allNoteLayouts: NoteLayout[], noteheadWidth: number): LayoutTuplet[] {
    const layouts: LayoutTuplet[] = []

    for (const tupletSet of measure.tuplets) {
        const firstTupletNote = tupletSet.values().next().value
        if (!firstTupletNote) continue
        const { numerator: notesOccupied, denominator: numNotes } = firstTupletNote.duration.ratio

        // Find all NoteLayouts belonging to this tuplet
        const tupletNotes = allNoteLayouts.filter((nl) => nl.tupletGroup === tupletSet)
        if (tupletNotes.length === 0) continue

        // Determine stem direction (majority vote)
        const upCount = tupletNotes.filter((nl) => nl.stemDir === 'up').length
        const stemDir: 'up' | 'down' = upCount >= tupletNotes.length / 2 ? 'up' : 'down'
        const location: 1 | -1 = stemDir === 'up' ? 1 : -1

        // x bounds
        const x1 = tupletNotes[0].note.x
        const x2 = tupletNotes[tupletNotes.length - 1].note.x + noteheadWidth

        // Check if all tuplet notes are beamed (have no flags and have stems adjusted by beam)
        const allBeamed = tupletNotes.every((nl) => nl.note.flag === undefined && nl.input.duration.isBeamable)

        // Y position: based on stem tips or note positions
        let y: number
        if (stemDir === 'up') {
            // Bracket above: find the highest stem tip (lowest Y)
            const stemTips = tupletNotes.map((nl) => nl.note.stem?.y2 ?? nl.note.y)
            y = Math.min(...stemTips) - TUPLET_OFFSET
        } else {
            // Bracket below: find the lowest stem tip (highest Y)
            const stemTips = tupletNotes.map((nl) => nl.note.stem?.y2 ?? nl.note.y)
            y = Math.max(...stemTips) + TUPLET_OFFSET
        }

        // Number glyphs: "3" or "3:2"
        const centerX = (x1 + x2) / 2
        const numberGlyphs = buildTupletNumberGlyphs(numNotes, notesOccupied, false, centerX, y)

        layouts.push({
            x1,
            x2,
            y,
            location,
            numberGlyphs,
            bracketed: !allBeamed,
        })
    }

    return layouts
}

/**
 * Build the glyph array for the tuplet number (e.g., "3" or "3:2").
 * Uses timeSig glyphs at TUPLET_NUMBER_SCALE.
 */
function buildTupletNumberGlyphs(
    numNotes: number,
    notesOccupied: number,
    showRatio: boolean | undefined,
    centerX: number,
    y: number,
): LayoutGlyph[] {
    const digits = String(numNotes).split('')
    const glyphs: LayoutGlyph[] = []

    // Calculate total width of all glyphs to center them
    const glyphNames = digits.map((d) => `timeSig${d}`)

    let ratioGlyphNames: string[] = []
    if (showRatio) {
        const denomDigits = String(notesOccupied).split('')
        ratioGlyphNames = denomDigits.map((d) => `timeSig${d}`)
    }

    // Total width at tuplet scale
    const scale = TUPLET_NUMBER_SCALE
    let totalWidth = glyphNames.reduce((sum, name) => sum + getGlyphWidth(name, scale), 0)
    if (showRatio && ratioGlyphNames.length > 0) {
        totalWidth += 4 // colon spacing
        totalWidth += ratioGlyphNames.reduce((sum, name) => sum + getGlyphWidth(name, scale), 0)
    }

    let x = centerX - totalWidth / 2

    // Numerator digits
    for (const name of glyphNames) {
        glyphs.push({ glyphName: name, x, y })
        x += getGlyphWidth(name, scale)
    }

    // Ratio ":N" if requested
    if (showRatio && ratioGlyphNames.length > 0) {
        x += 4 // colon spacing
        for (const name of ratioGlyphNames) {
            glyphs.push({ glyphName: name, x, y })
            x += getGlyphWidth(name, scale)
        }
    }

    return glyphs
}

/**
 * Compute beam segments for a group of notes.
 * Adjusts stems and suppresses flags as side effects.
 */
/* eslint-disable @typescript-eslint/no-non-null-assertion -- beamed notes always have stems */
function layoutBeamGroup(group: NoteLayout[]): LayoutBeamSegment[] {
    const stemDir = group[0].stemDir
    const dirSign = stemDir === 'up' ? -1 : 1 // up = negative Y direction

    // 1. Compute slope
    const first = group[0].note
    const last = group[group.length - 1].note
    const firstStemX = first.stem!.x
    const lastStemX = last.stem!.x
    const firstStemTipY = first.stem!.y2
    const lastStemTipY = last.stem!.y2
    const dx = lastStemX - firstStemX

    let slope = 0
    if (dx !== 0) {
        const rawSlope = (lastStemTipY - firstStemTipY) / dx
        // Ideal slope is half of raw (engraving convention), clamped
        slope = Math.max(-BEAM_MAX_SLOPE, Math.min(BEAM_MAX_SLOPE, rawSlope / 2))
    }

    // 2. Calculate beam y-position at first stem, ensuring no stems poke through
    let beamFirstY = firstStemTipY
    for (const nl of group) {
        const stemX = nl.note.stem!.x
        const beamYAtNote = beamFirstY + (stemX - firstStemX) * slope
        const stemTipY = nl.note.stem!.y2

        if (stemDir === 'up' && beamYAtNote > stemTipY) {
            // Beam is below stem tip — shift beam up
            beamFirstY -= beamYAtNote - stemTipY
        } else if (stemDir === 'down' && beamYAtNote < stemTipY) {
            // Beam is above stem tip — shift beam down
            beamFirstY += stemTipY - beamYAtNote
        }
    }

    // 3. Extend stems to reach the beam line and suppress flags
    for (const nl of group) {
        const stem = nl.note.stem!
        const beamYAtNote = beamFirstY + (stem.x - firstStemX) * slope
        stem.y2 = beamYAtNote
        // Suppress flag — beamed notes don't have flags
        nl.note.flag = undefined
    }

    // 4. Generate beam segments for each level
    const maxBeams = Math.max(...group.map((nl) => nl.input.duration.beamCount))
    const segments: LayoutBeamSegment[] = []
    const thickness = BEAM_WIDTH * dirSign

    for (let level = 0; level < maxBeams; level++) {
        const beamY = beamFirstY - level * BEAM_LEVEL_STRIDE * dirSign

        if (level === 0) {
            // Primary beam: always spans full group
            const y1 = beamY
            const y2 = beamY + (lastStemX - firstStemX) * slope
            segments.push({ x1: firstStemX, y1, x2: lastStemX, y2, thickness })
        } else {
            // Secondary beams: only for notes with enough beam levels
            const minBeamsForLevel = level + 1
            let segStart: number | null = null
            let segStartY: number | null = null

            for (let i = 0; i < group.length; i++) {
                const nl = group[i]
                const noteBeams = nl.input.duration.beamCount
                const stemX = nl.note.stem!.x
                const yAtNote = beamY + (stemX - firstStemX) * slope

                if (noteBeams >= minBeamsForLevel) {
                    if (segStart === null) {
                        segStart = stemX
                        segStartY = yAtNote
                    }

                    // Check if next note also qualifies — if not, close segment
                    const nextQualifies =
                        i + 1 < group.length && group[i + 1].input.duration.beamCount >= minBeamsForLevel
                    if (!nextQualifies) {
                        if (segStart === stemX) {
                            // Single note with secondary beam — draw partial beam
                            const partialDir = i === 0 ? 1 : -1 // first note: right, otherwise: left
                            const px1 = stemX
                            const px2 = stemX + partialDir * PARTIAL_BEAM_LENGTH
                            const py1 = yAtNote
                            const py2 = yAtNote + partialDir * PARTIAL_BEAM_LENGTH * slope
                            segments.push({ x1: px1, y1: py1, x2: px2, y2: py2, thickness })
                        } else {
                            segments.push({ x1: segStart, y1: segStartY!, x2: stemX, y2: yAtNote, thickness })
                        }
                        segStart = null
                        segStartY = null
                    }
                }
            }
        }
    }

    return segments
}

/** Vertical offset from notehead center to tie endpoint */
const TIE_Y_SHIFT = 7

/**
 * Compute tie curves for notes with `tie: true`.
 * Each tie connects a note to the next note event.
 */
function computeTies(inputMeasures: Measure[], layoutMeasures: LayoutMeasure[]): LayoutTie[] {
    const ties: LayoutTie[] = []
    const noteheadWidth = getGlyphWidth('noteheadBlack')

    // Build a map of noteId → LayoutNote
    const noteLayoutMap = new Map<string, LayoutNote>()
    for (const measure of layoutMeasures) {
        for (const note of measure.notes) {
            noteLayoutMap.set(note.noteId, note)
        }
    }

    // Scan score for tied notes
    for (const measure of inputMeasures) {
        for (const note of measure.notes) {
            if (note.tie) {
                const startNote = noteLayoutMap.get(note.id)
                const nextNote = note.getNext()
                const endNote = nextNote ? noteLayoutMap.get(nextNote.id) : undefined
                if (startNote && endNote) {
                    // Direction: opposite of stem. Stem up → tie below (1), stem down → tie above (-1)
                    const stemUp = startNote.stem ? startNote.stem.y2 < startNote.stem.y1 : true
                    const direction: 1 | -1 = stemUp ? 1 : -1
                    const yShift = TIE_Y_SHIFT * direction

                    ties.push({
                        startX: startNote.x + noteheadWidth,
                        startY: startNote.y + yShift,
                        endX: endNote.x,
                        endY: endNote.y + yShift,
                        direction,
                    })
                }
            }
        }
    }

    return ties
}

/**
 * Compute tempo marking positions for notes with `tempo` set.
 */
function computeTempoMarkings(inputMeasures: Measure[], layoutMeasures: LayoutMeasure[]): LayoutTempoMarking[] {
    const markings: LayoutTempoMarking[] = []

    // Build a map of noteId → LayoutNote
    const noteLayoutMap = new Map<string, LayoutNote>()
    for (const measure of layoutMeasures) {
        for (const note of measure.notes) {
            noteLayoutMap.set(note.noteId, note)
        }
    }

    for (const measure of inputMeasures) {
        for (const note of measure.notes) {
            if (note.tempo !== undefined) {
                const layoutNote = noteLayoutMap.get(note.id)
                if (layoutNote) {
                    markings.push({
                        noteEventIndex: layoutNote.noteEventIndex,
                        noteId: note.id,
                        x: layoutNote.x,
                        y: TEMPO_MARKING_Y,
                        bpm: note.tempo,
                    })
                }
            }
        }
    }

    return markings
}
