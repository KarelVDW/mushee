import { compact, groupBy, keyBy, last, sumBy } from 'lodash-es'

import { Clef } from './Clef'
import { Duration } from './Duration'
import { ScoreLayout } from './layout/ScoreLayout'
import { Measure } from './Measure'
import { Note } from './Note'
import { Row } from './Row'
import { Tie } from './Tie'
import { TimeSignature } from './TimeSignature'
import { MeasureSerializer } from './util/ScoreSerializer'

export class Score {
    readonly measures: Measure[] = []
    private _layout: ScoreLayout | null = null
    private _rows: Row[] = []
    private _rowByMeasure: Map<Measure, Row> = new Map()
    private _indexByMeasure: Map<Measure, number> = new Map()
    private _clefByMeasure: Map<Measure, Clef> = new Map()
    private _tiesByNote: Map<Note, Tie> = new Map()
    private onChange: () => void
    private _dirtyMeasures = new Set<Measure>()
    private _structureChanged = false

    constructor(onChange?: () => void) {
        this.onChange = () => {
            this.invalidateLayout()
            onChange?.()
        }
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

    getClefForMeasure(measure: Measure): Clef | undefined {
        return this._clefByMeasure.get(measure)
    }

    /** Resolve the active time signature at a given measure index by walking backwards. */
    getActiveTimeSignature(measureIndex: number): TimeSignature | undefined {
        for (let i = measureIndex; i >= 0; i--) {
            const ts = this.measures[i].timeSignature
            if (ts) return ts
        }
        return undefined
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

    addMeasure(measure = new Measure(this), index = this.measures.length) {
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
        this._rebuildClefMap()
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
            this._clefByMeasure.delete(removed)
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

    private _rebuildClefMap() {
        this._clefByMeasure.clear()
        let active: Clef | undefined
        for (const measure of this.measures) {
            if (measure.clef) active = measure.clef
            if (active) this._clefByMeasure.set(measure, active)
        }
    }

    private _rebuildRows() {
        this._rows = []
        this._rowByMeasure.clear()
        for (const measure of this.measures) {
            measure.setRowStartClef(undefined)
            let row = last(this._rows)
            if (!row || !row.canFit(measure)) {
                const activeClef = this._clefByMeasure.get(measure)
                if (!measure.clef && activeClef) measure.setRowStartClef(activeClef)
                row = new Row(this, this._rows.length)
                this._rows.push(row)
            }
            row.addMeasure(measure)
            this._rowByMeasure.set(measure, row)
        }
    }

    private _rebuildTies() {
        this._tiesByNote.clear()
        for (const measure of this.measures) {
            for (const note of measure.notes) {
                this._addTieEntryFor(note)
            }
        }
    }

    replace(targets: Note[], values: Note[]) {
        if (!targets.length) throw new Error('Replace targets can not be empty')
        if (!values.length) throw new Error('Replace values can not be empty')
        let targetBeats = sumBy(targets, (n) => n.duration.effectiveBeats)
        let valueBeats = sumBy(values, (n) => n.duration.effectiveBeats)

        while (targetBeats < valueBeats) {
            const lastTarget = targets[targets.length - 1]
            let nextNote = lastTarget.getNext()
            if (!nextNote) this.addMeasure().complete()
            nextNote = lastTarget.getNext()
            if (!nextNote) throw new Error('Trouble finding next note')
            targets = compact([...targets, nextNote])
            targetBeats += nextNote.duration.effectiveBeats
        }
        if (targetBeats > valueBeats) {
            values = [...values, ...Duration.fromBeats(targetBeats - valueBeats).map((d) => new Note({ duration: d }))]
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
            while (freeBeats > 0) {
                const note = replaceValues.shift()
                if (!note) break
                const noteBeats = note.duration.effectiveBeats
                if (note.duration.effectiveBeats <= freeBeats) {
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
    flushDirty(): { measures?: Record<string, unknown>; allMeasures?: unknown[] } | null {
        if (!this._structureChanged && this._dirtyMeasures.size === 0) return null

        if (this._structureChanged) {
            // Structure changed (add/remove measure) — send all measures
            const allMeasures = this.measures.map((m) => new MeasureSerializer(m).serialize())
            this.clearDirty()
            return { allMeasures }
        }

        // Only specific measures changed — send partial update
        const measures: Record<string, unknown> = {}
        for (const measure of this._dirtyMeasures) {
            const index = this._indexByMeasure.get(measure)
            if (index !== undefined) {
                measures[String(index)] = new MeasureSerializer(measure).serialize()
            }
        }
        this.clearDirty()
        return { measures }
    }
}
