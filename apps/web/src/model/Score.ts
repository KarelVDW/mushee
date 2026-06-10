import { compact, groupBy, keyBy, last, sumBy } from 'lodash-es'

import type { ClefType, DurationType } from '@/components/notation/types'

import { Duration } from './Duration'
import { Instrument } from './Instrument'
import { ScoreLayout } from './layout/ScoreLayout'
import { Measure } from './Measure'
import { Note } from './Note'
import { Row } from './Row'
import { Tie } from './Tie'
import { TimeSignature } from './TimeSignature'
import { MeasureSerializer } from './util/ScoreSerializer'

/** Tolerance for beat-sum comparisons — tuplet beats (e.g. thirds) don't sum exactly in floating point. */
const BEAT_EPSILON = 0.001

export class Score {
    /** Tempo assumed before any explicit marking — matches the playback engines' fallback. */
    static readonly DEFAULT_BPM = 90

    readonly measures: Measure[] = []
    private _instrument: Instrument = Instrument.Piano
    private _layout: ScoreLayout | null = null
    private _rows: Row[] = []
    private _rowByMeasure: Map<Measure, Row> = new Map()
    private _indexByMeasure: Map<Measure, number> = new Map()
    private _tiesByNote: Map<Note, Tie> = new Map()
    private onChange: () => void
    private _dirtyMeasures = new Set<Measure>()
    private _structureChanged = false
    private _instrumentDirty = false
    private _rebuildingRows = false
    private _tempoMap: number[] | null = null

    constructor(onChange?: () => void) {
        this.onChange = () => {
            this.invalidateLayout()
            this._tempoMap = null
            onChange?.()
        }
    }

    get instrument(): Instrument {
        return this._instrument
    }

    /**
     * Switch the score's lead instrument. Notes are stored as written pitch
     * (MusicXML semantics), so to preserve the actual sounding music when the
     * new instrument has a different transposition we rewrite every note and
     * key signature by `oldTranspose − newTranspose`. Trumpet writing C5 (sounds
     * B♭4) becomes a flute written B♭4 (still sounds B♭4) — the audience hears
     * the same music; the trumpeter's "do" becomes the flutist's "si bémol".
     *
     * The note rewrite goes through `replace` so tie tracking and layout state
     * stay consistent. Note identities change — callers holding a Note ref
     * (e.g. the editor's active note) need to re-resolve by position.
     */
    setInstrument(instrument: Instrument) {
        if (this._instrument === instrument) return

        const deltaChromatic = this._instrument.chromaticTranspose - instrument.chromaticTranspose
        const deltaDiatonic = this._instrument.diatonicTranspose - instrument.diatonicTranspose

        if (deltaChromatic !== 0 || deltaDiatonic !== 0) {
            const targets: Note[] = []
            const values: Note[] = []
            for (const measure of this.measures) {
                measure.transposeKeySignatures(deltaChromatic, deltaDiatonic)
                for (const note of measure.notes) {
                    targets.push(note)
                    values.push(note.clone(note.pitch ? { pitch: note.pitch.transposed(deltaChromatic, deltaDiatonic) } : {}))
                }
            }
            if (targets.length > 0) this.replace(targets, values)
            // Re-propagate the transposed key signatures forward (inherited leading keys follow the explicit ones).
            this._rebuildRows()
        }

        this._instrument = instrument
        this._instrumentDirty = true
        this.onChange()
    }

    /** Set the initial instrument without marking the score dirty — for deserialization only. */
    seedInstrument(instrument: Instrument) {
        this._instrument = instrument
    }

    get layout() {
        this._layout ||= new ScoreLayout(this)
        return this._layout
    }

    get rows(): Row[] {
        return this._rows
    }

    getRowForMeasure(measure: Measure) {
        const row = this._rowByMeasure.get(measure)
        if (!row) throw new Error('Measure not part of a row')
        return row
    }

    getTieByNote(note: Note): Tie | undefined {
        return this._tiesByNote.get(note)
    }

    private _removeTieEntriesFor(note: Note) {
        const tie = this._tiesByNote.get(note)
        if (!tie) return
        this._tiesByNote.delete(tie.note)
        this._tiesByNote.delete(tie.nextNote)
    }

    private _addTieEntryFor(note: Note) {
        if (!note.tiesForward) return
        let nextNote: Note | null
        try {
            nextNote = note.getNext()
        } catch {
            return
        }
        if (!nextNote) return
        const tie = new Tie(note, nextNote)
        this._tiesByNote.set(note, tie)
        const startRow = this._rowByMeasure.get(tie.note.measure)
        const endRow = this._rowByMeasure.get(tie.nextNote.measure)
        if (startRow && endRow && startRow !== endRow) {
            this._tiesByNote.set(nextNote, tie)
        }
    }

    invalidateLayout() {
        this._layout = null
    }

    markMeasureDirty(measure: Measure) {
        this._dirtyMeasures.add(measure)
    }

    markStructureChanged() {
        this._structureChanged = true
    }

    getIndexForMeasure(measure: Measure): number {
        const index = this._indexByMeasure.get(measure)
        if (index === undefined) throw new Error('Measure not part of this score')
        return index
    }

    clearDirty() {
        this._dirtyMeasures.clear()
        this._structureChanged = false
        this._instrumentDirty = false
    }

    get totalNotes(): number {
        return this.measures.reduce((sum, m) => sum + m.notes.length, 0)
    }

    get firstMeasure(): Measure | null {
        return this.measures[0] ?? null
    }

    get lastMeasure(): Measure | null {
        return this.measures[this.measures.length - 1] ?? null
    }

    get firstRow(): Row | null {
        return this.rows[0] ?? null
    }

    get lastRow(): Row | null {
        return this.rows[this.rows.length - 1] ?? null
    }

    getNextMeasure(measure?: Measure): Measure | null {
        if (!measure) return this.firstMeasure
        const measureIndex = this._indexByMeasure.get(measure)
        if (measureIndex === undefined) return null
        return this.measures[measureIndex + 1] ?? null
    }

    getPreviousMeasure(measure: Measure): Measure | null {
        const measureIndex = this._indexByMeasure.get(measure)
        if (measureIndex === undefined || measureIndex < 1) return null
        return this.measures[measureIndex - 1] ?? null
    }

    addMeasure(index = this.measures.length, measure?: Measure) {
        if (!measure) {
            const previous = this.measures[index - 1]
            // Inherit the clef and key *leaving* the previous measure (its last ones carry forward).
            const inheritedClefType = previous?.lastClef.type ?? 'treble'
            const inheritedKey = previous?.lastKey
            const inheritedTimeSignature = previous?.timeSignature ?? new TimeSignature(4, 4)
            measure = new Measure(this, inheritedClefType, inheritedTimeSignature, {
                keyFifths: inheritedKey?.fifths ?? 0,
                keyMode: inheritedKey?.mode,
            })
        }
        this.measures.splice(index, 0, measure)
        this._rebuildIndexMap()
        const previousMeasure = index > 0 ? this.measures[index - 1] : undefined
        const nextMeasure = this.measures[index + 1]
        if (nextMeasure) {
            measure.setEndBarline('single')
        } else {
            previousMeasure?.setEndBarline('single')
            measure.setEndBarline('end')
        }
        this._rebuildRows()
        this._rebuildTies()
        this.markStructureChanged()
        this.onChange()
        return measure
    }

    removeLastMeasure() {
        const removed = this.measures.pop()
        if (removed) {
            for (const note of removed.notes) this._removeTieEntriesFor(note)
            this._rowByMeasure.delete(removed)
            this._indexByMeasure.delete(removed)
            const lastRow = last(this._rows)
            if (lastRow) {
                lastRow.removeLastMeasure()
                if (lastRow.isEmpty) {
                    this._rows.pop()
                }
            }
            const newLastMeasure = last(this.measures)
            const newLastNote = newLastMeasure && newLastMeasure.notes[newLastMeasure.notes.length - 1]
            if (newLastNote) this._removeTieEntriesFor(newLastNote)
        }
        last(this.measures)?.setEndBarline('end')
        this.markStructureChanged()
        this.onChange()
    }

    private _rebuildIndexMap() {
        this._indexByMeasure.clear()
        this.measures.forEach((m, i) => this._indexByMeasure.set(m, i))
    }

    private _rebuildRows() {
        this._rebuildingRows = true
        try {
            this._rows = []
            this._rowByMeasure.clear()
            let prevClefType: ClefType | undefined
            let prevKeyFifths: number | undefined
            let prevTimeSignature: TimeSignature | undefined
            let activeClefType: ClefType = 'treble'
            let activeKeyFifths = 0
            let activeKeyMode: string | undefined
            for (const measure of this.measures) {
                if (measure.leadingClefExplicit) activeClefType = measure.clef.type
                else measure.setLeadingClefType(activeClefType)

                if (measure.leadingKeyExplicit) {
                    activeKeyFifths = measure.keySignature.fifths
                    activeKeyMode = measure.keySignature.mode
                } else measure.setLeadingKey(activeKeyFifths, activeKeyMode)
                // Cancellation naturals depend on the (now-finalized) preceding measure's key, so refresh here.
                measure.refreshKeySignatures()

                measure.setShowsClef(prevClefType === undefined || prevClefType !== measure.clef.type)
                measure.setShowsKeySignature(prevKeyFifths === undefined || prevKeyFifths !== measure.keySignature.fifths)
                measure.setShowsTimeSignature(
                    !prevTimeSignature ||
                        prevTimeSignature.beatAmount !== measure.timeSignature.beatAmount ||
                        prevTimeSignature.beatType !== measure.timeSignature.beatType,
                )
                let row = last(this._rows)
                if (!row || !row.canFit(measure)) {
                    row = new Row(this, this._rows.length)
                    this._rows.push(row)
                    measure.setShowsClef(true)
                    measure.setShowsKeySignature(true)
                }
                row.addMeasure(measure)
                this._rowByMeasure.set(measure, row)
                activeClefType = measure.lastClef.type
                activeKeyFifths = measure.lastKey.fifths
                activeKeyMode = measure.lastKey.mode
                prevClefType = activeClefType
                prevKeyFifths = activeKeyFifths
                prevTimeSignature = measure.timeSignature
            }
        } finally {
            this._rebuildingRows = false
        }
    }

    /**
     * Called by a Measure when its minimalWidth changes. Re-runs row composition
     * so that a measure that has grown past what its row can hold is pushed onto
     * a new row (preventing ResizeError in RowLayout). Re-entry from inside
     * _rebuildRows itself is suppressed.
     */
    onMeasureWidthChanged(measure: Measure) {
        if (this._rebuildingRows) return
        if (!this._indexByMeasure.has(measure)) return
        this._rebuildRows()
        this._rebuildTies()
        this.invalidateLayout()
    }

    private _rebuildTies() {
        this._tiesByNote.clear()
        for (const measure of this.measures) {
            for (const note of measure.notes) {
                this._addTieEntryFor(note)
            }
        }
    }

    setTempo(note: Note | null | undefined, bpm: number | undefined) {
        if (!note) return
        const measure = note.measure
        const beat = measure.beatOffsetOf(note)
        if (bpm === undefined) measure.removeTempo(beat)
        else measure.setTempo(beat, bpm)
        this.markMeasureDirty(measure)
        this.onChange()
    }

    setClef(note: Note | null | undefined, type: ClefType) {
        if (!note) return
        const measure = note.measure
        const beat = measure.beatOffsetOf(note)
        if (beat === 0) {
            const carriedIn = this.getPreviousMeasure(measure)?.lastClef.type ?? 'treble'
            if (type === carriedIn) measure.makeLeadingClefInherited()
            else measure.setClef(0, type)
        } else measure.setClef(beat, type)
        this.markMeasureDirty(measure)
        this._rebuildRows()
        this.onChange()
    }

    setKeySignature(note: Note | null | undefined, fifths: number, mode?: string) {
        if (!note) return
        const measure = note.measure
        const beat = measure.beatOffsetOf(note)
        if (beat === 0) {
            const carried = this.getPreviousMeasure(measure)?.lastKey
            // Demote to inherited only when nothing changes; a relative major↔minor switch (same fifths,
            // different mode) is still a real boundary and must be kept explicit so the mode is preserved.
            if (fifths === (carried?.fifths ?? 0) && mode === carried?.mode) measure.makeLeadingKeyInherited()
            else measure.setKeySignature(0, fifths, mode)
        } else measure.setKeySignature(beat, fifths, mode)
        this.markMeasureDirty(measure)
        this._rebuildRows()
        this.onChange()
    }

    /**
     * BPM in effect entering each measure, indexed by measure position. Built in a
     * single pass and cached; the onChange wrapper clears it on any mutation, so
     * reading the tempo at an arbitrary note (see {@link bpmAt}) never re-scans the
     * whole score on every call.
     */
    private get tempoMap(): number[] {
        if (this._tempoMap) return this._tempoMap
        const map: number[] = []
        let current = Score.DEFAULT_BPM
        for (const measure of this.measures) {
            map.push(current)
            const latest = measure.lastTempo
            if (latest) current = latest.bpm
        }
        this._tempoMap = map
        return map
    }

    /** The tempo (BPM) sounding at `note`: the nearest marking at or before it, else the default. */
    bpmAt(note: Note | null | undefined): number {
        if (!note) return Score.DEFAULT_BPM
        const measure = note.measure
        const local = measure.tempoAtOrBefore(measure.beatOffsetOf(note))
        if (local) return local.bpm
        return this.tempoMap[this.getIndexForMeasure(measure)] ?? Score.DEFAULT_BPM
    }

    /**
     * Change a note's written duration (type and/or dots; omitted parts keep the
     * note's current value). Inside a tuplet the change stays in the group's ratio
     * and is clipped to the group's end — freed slot space is padded with tuplet
     * rests by `replace` — so the group's span never changes. A change that covers
     * the whole group from its first slot reads better as plain notation, so it
     * leaves tuplet space. Returns the note to select next, or null without a note.
     */
    setDuration(note: Note | null | undefined, value: { type?: DurationType; dots?: number }): Note | null {
        if (!note) return null
        const ratio = note.duration.ratio
        let durations = [new Duration({ type: value.type ?? note.duration.type, dots: value.dots ?? note.duration.dots, ratio })]
        const tuplet = note.measure.tupletGroupOf(note)
        if (tuplet) {
            const index = tuplet.getIndex(note) ?? 0
            const remainder = sumBy(tuplet.notes.slice(index), (n) => n.duration.effectiveBeats)
            if (durations[0].effectiveBeats > remainder + BEAT_EPSILON) {
                durations = index === 0 ? Duration.fromBeats(remainder) : Duration.fromBeats(remainder, ratio)
            }
        }
        if (!durations.length) return null
        const values = durations.map((d, i) => note.clone({ duration: d, ...(note.pitch && i < durations.length - 1 && { tie: 'start' as const }) }))
        return this.replace([note], values)[0] ?? null
    }

    /**
     * Toggle the note between plain and triplet notation. A plain note becomes three
     * notes of the next-shorter value (3:2) — its pitch on the first, rests after. A
     * note inside a tuplet collapses the whole group back to plain notes of the same
     * total length, carrying the selected note's pitch. Returns the note to select
     * next, or null when nothing changed (no shorter value exists, or the group's
     * length isn't representable in plain notes).
     */
    toggleTuplet(note: Note | null | undefined): Note | null {
        if (!note) return null
        const tuplet = note.measure.tupletGroupOf(note)
        if (tuplet) {
            const totalBeats = sumBy(tuplet.notes, (n) => n.duration.effectiveBeats)
            const durations = Duration.fromBeats(totalBeats)
            if (Math.abs(sumBy(durations, (d) => d.beats) - totalBeats) > BEAT_EPSILON) return null
            const values = durations.map(
                (d, i) => new Note({ duration: d, pitch: note.pitch, ...(note.pitch && i < durations.length - 1 && { tie: 'start' as const }) }),
            )
            return this.replace(tuplet.notes, values)[0] ?? null
        }
        const durations = note.duration.tripletDivision()
        if (!durations) return null
        const values = durations.map((d, i) => new Note({ duration: d, pitch: i === 0 ? note.pitch : undefined }))
        return this.replace([note], values)[0] ?? null
    }

    replace(targets: Note[], values: Note[]) {
        if (!targets.length) throw new Error('Replace targets can not be empty')
        if (!values.length) throw new Error('Replace values can not be empty')
        let targetBeats = sumBy(targets, (n) => n.duration.effectiveBeats)
        let valueBeats = sumBy(values, (n) => n.duration.effectiveBeats)

        while (targetBeats < valueBeats - BEAT_EPSILON) {
            const lastTarget = targets[targets.length - 1]
            let nextNote = lastTarget.getNext()
            if (!nextNote) this.addMeasure().complete()
            nextNote = lastTarget.getNext()
            if (!nextNote) throw new Error('Trouble finding next note')
            targets = compact([...targets, nextNote])
            targetBeats += nextNote.duration.effectiveBeats
        }
        if (targetBeats > valueBeats + BEAT_EPSILON) {
            // The gap sits at the end of the replaced range — pad in that note's space:
            // inside a tuplet it is a fraction no plain duration can express.
            const ratio = targets[targets.length - 1].duration.ratio
            values = [...values, ...Duration.fromBeats(targetBeats - valueBeats, ratio).map((d) => new Note({ duration: d }))]
            valueBeats += targetBeats - valueBeats
        }
        const measuresById = keyBy(
            targets.map((n) => n.measure),
            (m) => m.id,
        )
        const targetsByMeasure = groupBy(targets, (n) => n.measure.id)
        let replaceValues = [...values]
        const allNewNotes = []
        for (const [measureId, notes] of Object.entries(targetsByMeasure)) {
            const measure = measuresById[measureId]
            const newNotes = []
            let freeBeats = sumBy(notes, (n) => n.duration.effectiveBeats)
            let remainderNotes: Note[] = []
            while (freeBeats > BEAT_EPSILON) {
                const note = replaceValues.shift()
                if (!note) break
                const noteBeats = note.duration.effectiveBeats
                if (noteBeats <= freeBeats + BEAT_EPSILON) {
                    newNotes.push(note)
                    freeBeats -= noteBeats
                } else {
                    const remainderBeats = noteBeats - freeBeats
                    newNotes.push(...Duration.fromBeats(freeBeats).map((d) => new Note({ duration: d, pitch: note.pitch, tie: 'start' })))
                    freeBeats = 0
                    const remainderDurations = Duration.fromBeats(remainderBeats)
                    remainderNotes = remainderDurations.map(
                        (d, i) => new Note({ duration: d, pitch: note.pitch, ...(i != remainderDurations.length - 1 && { tie: 'start' }) }),
                    )
                }
            }
            measure.replaceNotes(notes, newNotes)
            this.markMeasureDirty(measure)
            replaceValues = [...remainderNotes, ...replaceValues]
            this.getRowForMeasure(measure).invalidateLayout()
            allNewNotes.push(...newNotes)
        }
        for (const note of targets) this._removeTieEntriesFor(note)
        for (const note of allNewNotes) this._addTieEntryFor(note)
        this.onChange()
        return allNewNotes
    }

    /** Serialize dirty state, then clear it. Returns null if nothing changed. */
    flushDirty(): { measures?: Record<string, unknown>; allMeasures?: unknown[]; partList?: Record<string, unknown> } | null {
        const hasMeasureChanges = this._structureChanged || this._dirtyMeasures.size > 0
        if (!hasMeasureChanges && !this._instrumentDirty) return null

        const result: { measures?: Record<string, unknown>; allMeasures?: unknown[]; partList?: Record<string, unknown> } = {}

        if (this._instrumentDirty) {
            result.partList = {
                scoreParts: [
                    {
                        id: 'P1',
                        partName: this._instrument.displayName,
                        scoreInstrument: { id: 'P1-I1', instrumentName: this._instrument.displayName },
                        midiInstrument: { id: 'P1-I1', midiProgram: this._instrument.gmProgram + 1 },
                    },
                ],
            }
        }

        if (this._structureChanged) {
            result.allMeasures = this.measures.map((m) => new MeasureSerializer(m).serialize())
        } else if (this._dirtyMeasures.size > 0) {
            const measures: Record<string, unknown> = {}
            for (const measure of this._dirtyMeasures) {
                const index = this._indexByMeasure.get(measure)
                if (index !== undefined) {
                    measures[String(index)] = new MeasureSerializer(measure).serialize()
                }
            }
            result.measures = measures
        }

        this.clearDirty()
        return result
    }
}
