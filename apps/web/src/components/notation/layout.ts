import {
    BARLINE_GAP,
    BARLINE_THICK_WIDTH,
    BARLINE_THIN_WIDTH,
    BEAM_LEVEL_STRIDE,
    BEAM_MAX_SLOPE,
    BEAM_WIDTH,
    CLEF_TIME_SIG_PADDING,
    LEDGER_LINE_EXTENSION,
    NUM_STAFF_LINES,
    PARTIAL_BEAM_LENGTH,
    SPACE_ABOVE_STAFF,
    STAVE_LEFT_PADDING,
    STAVE_LINE_DISTANCE,
    STAVE_RIGHT_PADDING,
    STEM_HEIGHT,
    TIME_SIG_NOTE_PADDING,
    TUPLET_NUMBER_SCALE,
    TUPLET_OFFSET,
} from './constants'
import { getGlyphWidth } from './glyph-utils'
import {
    accidentalGlyphName,
    beamCount,
    durationToBeats,
    flagGlyphName,
    getLedgerLinePositions,
    getYForLine,
    getYForNote,
    isBeamable,
    noteheadForDuration,
    parseKey,
    pitchToLine,
    restGlyphForDuration,
    restLine,
} from './note-utils'
import type {
    BarlineType,
    LayoutBarline,
    LayoutBeamSegment,
    LayoutGlyph,
    LayoutLine,
    LayoutMeasure,
    LayoutNote,
    LayoutResult,
    LayoutTimeSignature,
    LayoutTuplet,
    MeasureInput,
    NoteInput,
    ScoreInput,
    TupletInput,
} from './types'

/** Clef glyph placement: which staff line the glyph anchors to */
const CLEF_CONFIG: Record<string, { glyphName: string; lineIndex: number }> = {
    treble: { glyphName: 'gClef', lineIndex: 3 },
}

/** Internal note with layout info, used during beam computation */
interface NoteLayout {
    note: LayoutNote
    input: NoteInput
    stemDir: 'up' | 'down'
    beat: number
    noteIndex: number // index in voice.notes
    tupletIndex: number | undefined // index in voice.tuplets (if part of a tuplet)
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

/**
 * Build a map from note index → tuplet info for a voice.
 * Returns a Map<noteIndex, { tupletIndex, tuplet }>.
 */
function buildTupletMap(tuplets: TupletInput[] | undefined): Map<number, { tupletIndex: number; tuplet: TupletInput }> {
    const map = new Map<number, { tupletIndex: number; tuplet: TupletInput }>()
    if (!tuplets) return map
    for (let ti = 0; ti < tuplets.length; ti++) {
        const t = tuplets[ti]
        for (let ni = t.startIndex; ni < t.startIndex + t.count; ni++) {
            map.set(ni, { tupletIndex: ti, tuplet: t })
        }
    }
    return map
}

/**
 * Get the effective beats for a note, applying tuplet multiplier if applicable.
 */
function effectiveBeats(duration: NoteInput['duration'], tuplet: TupletInput | undefined): number {
    const beats = durationToBeats(duration)
    if (!tuplet) return beats
    const notesOccupied = tuplet.notesOccupied ?? 2
    return beats * notesOccupied / tuplet.count
}

export function computeLayout(input: ScoreInput, width: number = 600, height: number = 160): LayoutResult {
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

    for (const measure of input.measures) {
        let overhead = STAVE_LEFT_PADDING

        if (measure.clef) {
            const config = CLEF_CONFIG[measure.clef]
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

        // Total beats in this measure (applying tuplet multipliers)
        let maxBeats = 0
        for (const voice of measure.voices) {
            const tupletMap = buildTupletMap(voice.tuplets)
            let beats = 0
            for (let ni = 0; ni < voice.notes.length; ni++) {
                const note = voice.notes[ni]
                const tupletInfo = tupletMap.get(ni)
                beats += effectiveBeats(note.duration, tupletInfo?.tuplet)
            }
            maxBeats = Math.max(maxBeats, beats)
        }
        measureBeats.push(Math.max(maxBeats, 1))
    }

    // 3. Compute barline widths
    const barlineTypes: BarlineType[] = input.measures.map((m) => m.endBarline ?? 'single')
    const openingBarlineW = BARLINE_THIN_WIDTH
    const barlineWidths = barlineTypes.map(barlineWidth)

    // 4. Distribute remaining width proportionally by beats
    const totalOverhead = measureOverheads.reduce((a, b) => a + b, 0)
    const totalBarlineWidth = openingBarlineW + barlineWidths.reduce((a, b) => a + b, 0)
    const totalBeats = measureBeats.reduce((a, b) => a + b, 0)
    const availableNoteWidth = Math.max(0, width - totalOverhead - totalBarlineWidth)

    // 5. Layout each measure
    let cursorX = 0
    const measures: LayoutMeasure[] = []
    const barlines: LayoutBarline[] = []

    // Opening barline
    barlines.push({
        x: cursorX,
        y: staffTopY,
        height: staffHeight,
        type: 'single',
    })
    cursorX += openingBarlineW

    for (let mi = 0; mi < input.measures.length; mi++) {
        const measureInput = input.measures[mi]
        const noteWidth = (measureBeats[mi] / totalBeats) * availableNoteWidth
        const measureWidth = measureOverheads[mi] + noteWidth
        const measureX = cursorX

        const measureLayout = computeMeasureLayout(measureInput, measureX, measureWidth, staveY)
        measures.push(measureLayout)

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

    return { width, height, staffLines, measures, barlines }
}

function computeMeasureLayout(
    input: MeasureInput,
    measureX: number,
    measureWidth: number,
    staveY: number,
): LayoutMeasure {
    // 1. Clef
    let cursorX = measureX + STAVE_LEFT_PADDING
    let clef: LayoutGlyph | undefined
    if (input.clef) {
        const config = CLEF_CONFIG[input.clef]
        if (config) {
            clef = { glyphName: config.glyphName, x: cursorX, y: getYForLine(config.lineIndex, staveY) }
            cursorX += getGlyphWidth(config.glyphName) + CLEF_TIME_SIG_PADDING
        }
    }

    // 2. Time signature
    let timeSignature: LayoutTimeSignature | undefined
    if (input.timeSignature) {
        const [topStr, bottomStr] = input.timeSignature.split('/')
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
    for (const voice of input.voices) {
        const tupletMap = buildTupletMap(voice.tuplets)
        let beat = 0
        for (let ni = 0; ni < voice.notes.length; ni++) {
            const note = voice.notes[ni]
            beatPositions.add(beat)
            const tupletInfo = tupletMap.get(ni)
            beat += effectiveBeats(note.duration, tupletInfo?.tuplet)
        }
    }
    const sortedBeats = Array.from(beatPositions).sort((a, b) => a - b)
    const numPositions = sortedBeats.length
    const beatToX = new Map<number, number>()
    for (let i = 0; i < numPositions; i++) {
        const x = notesStartX + (i / Math.max(numPositions - 1, 1)) * availableWidth * 0.85 + availableWidth * 0.05
        beatToX.set(sortedBeats[i], x)
    }

    // 4. Pre-compute beam group stem directions (so beamable notes get a uniform direction)
    const beamStemDirs = new Map<string, 'up' | 'down'>() // key: "voiceIdx:noteIdx"
    for (let vi = 0; vi < input.voices.length; vi++) {
        const voice = input.voices[vi]
        if ((voice.stem ?? 'auto') !== 'auto') continue // skip if voice has explicit stem pref
        const tupletMap = buildTupletMap(voice.tuplets)
        const groups = identifyPotentialBeamGroups(voice.notes, tupletMap, input.clef)
        for (const group of groups) {
            const avgLine = group.noteLines.reduce((a, b) => a + b, 0) / group.noteLines.length
            const groupDir: 'up' | 'down' = avgLine >= 3 ? 'down' : 'up'
            for (const ni of group.noteIndices) {
                beamStemDirs.set(`${vi}:${ni}`, groupDir)
            }
        }
    }

    // 5. Layout notes (first pass — default stems, flags)
    const noteheadWidth = getGlyphWidth('noteheadBlack')
    const allNoteLayouts: NoteLayout[] = []

    for (let vi = 0; vi < input.voices.length; vi++) {
        const voice = input.voices[vi]
        const voiceStemPref = voice.stem ?? 'auto'
        const tupletMap = buildTupletMap(voice.tuplets)
        let beat = 0

        for (let ni = 0; ni < voice.notes.length; ni++) {
            const noteInput = voice.notes[ni]
            const tupletInfo = tupletMap.get(ni)
            // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
            const x = beatToX.get(beat)!

            // Check if this note is a rest (first key has /r suffix)
            const { isRest: noteIsRest } = parseKey(noteInput.keys[0])

            if (noteIsRest) {
                // Rest: use rest glyph, default line, no stem/flag/accidental/ledger
                const rLine = restLine(noteInput.duration)
                const noteY = getYForNote(rLine, staveY)
                const glyphName = restGlyphForDuration(noteInput.duration)
                const layoutNote: LayoutNote = { x, y: noteY, glyphName, ledgerLines: [] }
                allNoteLayouts.push({
                    note: layoutNote,
                    input: noteInput,
                    stemDir: 'up',
                    beat,
                    noteIndex: ni,
                    tupletIndex: tupletInfo?.tupletIndex,
                    isRest: true,
                })
            } else {
                for (const key of noteInput.keys) {
                    const { accidental } = parseKey(key)
                    const noteLine = pitchToLine(key, input.clef)
                    const noteY = getYForNote(noteLine, staveY)
                    const glyphName = noteheadForDuration(noteInput.duration)
                    // Use beam group stem direction if available, otherwise fall back to per-note logic
                    const beamDir = beamStemDirs.get(`${vi}:${ni}`)
                    const dir: 'up' | 'down' = voiceStemPref !== 'auto'
                        ? voiceStemPref
                        : beamDir ?? (noteLine >= 3 ? 'down' : 'up')

                    // Accidental
                    let accidentalLayout: LayoutGlyph | undefined
                    if (accidental) {
                        const accGlyph = accidentalGlyphName(accidental)
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
                    if (noteInput.duration !== 'w') {
                        stem = dir === 'up'
                            ? { x: x + noteheadWidth, y1: noteY, y2: noteY - STEM_HEIGHT }
                            : { x: x, y1: noteY, y2: noteY + STEM_HEIGHT }
                    }

                    // Flag (will be suppressed for beamed notes in pass 2)
                    let flag: LayoutGlyph | undefined
                    const flagName = flagGlyphName(noteInput.duration, dir)
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

                    const layoutNote: LayoutNote = { x, y: noteY, glyphName, accidental: accidentalLayout, stem, flag, ledgerLines }
                    allNoteLayouts.push({
                        note: layoutNote,
                        input: noteInput,
                        stemDir: dir,
                        beat,
                        noteIndex: ni,
                        tupletIndex: tupletInfo?.tupletIndex,
                        isRest: false,
                    })
                }
            }

            beat += effectiveBeats(noteInput.duration, tupletInfo?.tuplet)
        }
    }

    // 6. Auto-beam: group consecutive beamable notes within each beat
    //    (tuplet notes stay grouped together — no beat-boundary breaks within a tuplet)
    const beamGroups = computeBeamGroups(allNoteLayouts)

    // 7. For each beam group: compute slope, adjust stems, generate segments, suppress flags
    const beams: LayoutBeamSegment[][] = []
    for (const group of beamGroups) {
        const segments = layoutBeamGroup(group)
        beams.push(segments)
    }

    // 8. Compute tuplet bracket layouts
    const tuplets = computeTupletLayouts(input, allNoteLayouts, noteheadWidth)

    return {
        x: measureX,
        width: measureWidth,
        clef,
        timeSignature,
        notes: allNoteLayouts.map((nl) => nl.note),
        beams,
        tuplets,
    }
}

interface PotentialBeamGroup {
    noteIndices: number[]
    noteLines: number[]
}

/**
 * Identify groups of consecutive beamable notes that could form beams,
 * ignoring stem direction. Used to pre-compute a uniform stem direction
 * based on average pitch so that beams aren't broken by mixed stem directions.
 */
function identifyPotentialBeamGroups(
    notes: NoteInput[],
    tupletMap: Map<number, { tupletIndex: number; tuplet: TupletInput }>,
    clef: string | undefined,
): PotentialBeamGroup[] {
    const groups: PotentialBeamGroup[] = []
    let currentIndices: number[] = []
    let currentLines: number[] = []
    let beat = 0

    for (let ni = 0; ni < notes.length; ni++) {
        const note = notes[ni]
        const tupletInfo = tupletMap.get(ni)

        const { isRest: noteIsRest } = parseKey(note.keys[0])
        if (!isBeamable(note.duration) || noteIsRest) {
            if (currentIndices.length >= 2) {
                groups.push({ noteIndices: currentIndices, noteLines: currentLines })
            }
            currentIndices = []
            currentLines = []
            beat += effectiveBeats(note.duration, tupletInfo?.tuplet)
            continue
        }

        // Check beat boundary (same logic as computeBeamGroups, minus stem direction check)
        if (currentIndices.length > 0) {
            const prevNi = currentIndices[currentIndices.length - 1]
            const prevTupletInfo = tupletMap.get(prevNi)
            const sameTuplet = prevTupletInfo?.tupletIndex !== undefined
                && prevTupletInfo.tupletIndex === tupletInfo?.tupletIndex

            if (!sameTuplet) {
                const prevNote = notes[prevNi]
                const prevBeat = beat - effectiveBeats(prevNote.duration, prevTupletInfo?.tuplet)
                const prevBeatBoundary = Math.floor(prevBeat)
                const nextBeatBoundary = Math.floor(beat)

                if (nextBeatBoundary > prevBeatBoundary) {
                    if (currentIndices.length >= 2) {
                        groups.push({ noteIndices: currentIndices, noteLines: currentLines })
                    }
                    currentIndices = []
                    currentLines = []
                }
            }
        }

        currentIndices.push(ni)
        // Average the note lines for chords (multiple keys)
        const avgLine = note.keys.reduce((sum, key) => sum + pitchToLine(key, clef), 0) / note.keys.length
        currentLines.push(avgLine)

        beat += effectiveBeats(note.duration, tupletInfo?.tuplet)
    }

    if (currentIndices.length >= 2) {
        groups.push({ noteIndices: currentIndices, noteLines: currentLines })
    }

    return groups
}

/**
 * Group consecutive beamable notes (8th, 16th) that fall within the same beat.
 * A beat boundary (integer beat position) breaks the group,
 * UNLESS both notes belong to the same tuplet.
 */
function computeBeamGroups(noteLayouts: NoteLayout[]): NoteLayout[][] {
    const groups: NoteLayout[][] = []
    let current: NoteLayout[] = []

    for (const nl of noteLayouts) {
        if (!isBeamable(nl.input.duration) || nl.isRest) {
            // Non-beamable note or rest: flush current group
            if (current.length >= 2) groups.push(current)
            current = []
            continue
        }

        // Check if this note crosses a beat boundary from the previous
        if (current.length > 0) {
            const prev = current[current.length - 1]
            const sameTuplet = prev.tupletIndex !== undefined && prev.tupletIndex === nl.tupletIndex

            if (!sameTuplet) {
                const prevBeatEnd = prev.beat + durationToBeats(prev.input.duration)
                const prevBeatBoundary = Math.floor(prev.beat)
                const nextBeatBoundary = Math.floor(nl.beat)

                // Break at beat boundaries
                if (nextBeatBoundary > prevBeatBoundary && prevBeatEnd <= nl.beat) {
                    if (current.length >= 2) groups.push(current)
                    current = []
                }
            }

            // Break if stem direction changes
            if (current.length > 0 && current[0].stemDir !== nl.stemDir) {
                if (current.length >= 2) groups.push(current)
                current = []
            }
        }

        current.push(nl)
    }

    if (current.length >= 2) groups.push(current)
    return groups
}

/**
 * Compute tuplet bracket layouts for all voices in a measure.
 */
function computeTupletLayouts(
    input: MeasureInput,
    allNoteLayouts: NoteLayout[],
    noteheadWidth: number,
): LayoutTuplet[] {
    const layouts: LayoutTuplet[] = []

    for (const voice of input.voices) {
        if (!voice.tuplets) continue

        for (let ti = 0; ti < voice.tuplets.length; ti++) {
            const tuplet = voice.tuplets[ti]
            const numNotes = tuplet.count
            const notesOccupied = tuplet.notesOccupied ?? 2

            // Find all NoteLayouts belonging to this tuplet
            const tupletNotes = allNoteLayouts.filter((nl) => nl.tupletIndex === ti)
            if (tupletNotes.length === 0) continue

            // Determine stem direction (majority vote)
            const upCount = tupletNotes.filter((nl) => nl.stemDir === 'up').length
            const stemDir: 'up' | 'down' = upCount >= tupletNotes.length / 2 ? 'up' : 'down'
            const location: 1 | -1 = stemDir === 'up' ? 1 : -1

            // x bounds
            const x1 = tupletNotes[0].note.x
            const x2 = tupletNotes[tupletNotes.length - 1].note.x + noteheadWidth

            // Check if all tuplet notes are beamed (have no flags and have stems adjusted by beam)
            const allBeamed = tupletNotes.every((nl) => nl.note.flag === undefined && isBeamable(nl.input.duration))

            // Y position: based on stem tips or note positions
            let y: number
            if (stemDir === 'up') {
                // Bracket above: find the highest stem tip (lowest Y)
                const stemTips = tupletNotes
                    .map((nl) => nl.note.stem?.y2 ?? nl.note.y)
                y = Math.min(...stemTips) - TUPLET_OFFSET
            } else {
                // Bracket below: find the lowest stem tip (highest Y)
                const stemTips = tupletNotes
                    .map((nl) => nl.note.stem?.y2 ?? nl.note.y)
                y = Math.max(...stemTips) + TUPLET_OFFSET
            }

            // Number glyphs: "3" or "3:2"
            const centerX = (x1 + x2) / 2
            const numberGlyphs = buildTupletNumberGlyphs(numNotes, notesOccupied, tuplet.showRatio, centerX, y)

            layouts.push({
                x1,
                x2,
                y,
                location,
                numberGlyphs,
                bracketed: !allBeamed,
            })
        }
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
    const maxBeams = Math.max(...group.map((nl) => beamCount(nl.input.duration)))
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
                const noteBeams = beamCount(nl.input.duration)
                const stemX = nl.note.stem!.x
                const yAtNote = beamY + (stemX - firstStemX) * slope

                if (noteBeams >= minBeamsForLevel) {
                    if (segStart === null) {
                        segStart = stemX
                        segStartY = yAtNote
                    }

                    // Check if next note also qualifies — if not, close segment
                    const nextQualifies = i + 1 < group.length && beamCount(group[i + 1].input.duration) >= minBeamsForLevel
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
