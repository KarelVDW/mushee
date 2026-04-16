import { compact, groupBy, keyBy, last, sumBy } from 'lodash-es'

import { Clef } from './Clef'
import { Duration } from './Duration'
import { ScoreLayout } from './layout/ScoreLayout'
import { Measure } from './Measure'
import { Note } from './Note'
import { Row } from './Row'
import { TimeSignature } from './TimeSignature'
import { MeasureSerializer } from './util/ScoreSerializer'

export class Score {
    readonly measures: Measure[] = []
    private _layout: ScoreLayout | null = null
    private _rows: Row[] = []
    private _rowByMeasure: Map<Measure, Row> = new Map()
    private _clefByMeasure: Map<Measure, Clef> = new Map()
    private onChange: () => void
    private _dirtyMeasures = new Set<number>()
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

    invalidateLayout() {
        this._layout = null
    }

    markMeasureDirty(index: number) {
        this._dirtyMeasures.add(index)
    }

    markStructureChanged() {
        this._structureChanged = true
    }

    get dirtyMeasureIndices(): number[] {
        return [...this._dirtyMeasures]
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
        const measureIndex = this.measures.findIndex((m) => m.index === measure.index)
        if (measureIndex < 0) return null
        const idx = measureIndex + 1
        return idx < this.measures.length ? (this.measures[idx] ?? null) : null
    }

    getPreviousMeasure(measure: Measure): Measure | null {
        const measureIndex = this.measures.findIndex((m) => m.index === measure.index)
        if (measureIndex < 1) return null
        return this.measures[measureIndex - 1] ?? null
    }

    addMeasure(measure = new Measure(this, this.measures.length)) {
        const previousMeasure = last(this.measures)
        previousMeasure?.setEndBarline('single')
        measure.setEndBarline('end')
        this.measures.push(measure)
        let row = last(this._rows)
        if (!row || !row.canFit(measure)) {
            row = new Row(this, this._rows.length)
            this._rows.push(row)
        }
        row.addMeasure(measure)
        this._rowByMeasure.set(measure, row)
        const activeClef = measure.clef ?? (previousMeasure && this._clefByMeasure.get(previousMeasure))
        if (activeClef) this._clefByMeasure.set(measure, activeClef)
        if (row.firstMeasures === measure && !measure.clef && activeClef) {
            measure.setRowStartClef(activeClef)
        }
        this.markStructureChanged()
        this.onChange()
        return measure
    }

    removeLastMeasure() {
        const removed = this.measures.pop()
        if (removed) {
            this._rowByMeasure.delete(removed)
            this._clefByMeasure.delete(removed)
            const lastRow = last(this._rows)
            if (lastRow) {
                lastRow.removeLastMeasure()
                if (lastRow.isEmpty) {
                    this._rows.pop()
                }
            }
        }
        last(this.measures)?.setEndBarline('end')
        this.markStructureChanged()
        this.onChange()
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
            (m) => m.index,
        )
        const targetsByMeasure = groupBy(targets, (n) => n.measure.index)
        let replaceValues = [...values]
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
                    remainderNotes = Duration.fromBeats(remainderBeats).map(
                        (d) => new Note({ duration: d, pitch: note.pitch, tie: 'start' }),
                    )
                }
            }
            measure.replaceNotes(notes, newNotes)
            this.markMeasureDirty(measure.index)
            replaceValues = [...remainderNotes, ...replaceValues]
            this.getRowForMeasure(measure).invalidateLayout()
        }
        this.onChange()
    }

    /** Serialize dirty state, then clear it. Returns null if nothing changed. */
    flushDirty(): { measures?: Record<string, unknown>; allMeasures?: unknown[] } | null {
        if (!this._structureChanged && this._dirtyMeasures.size === 0) return null

        if (this._structureChanged) {
            // Structure changed (add/remove measure) — send all measures
            const allMeasures = this.measures.map((m, mi) => new MeasureSerializer(m).serialize())
            this.clearDirty()
            return { allMeasures }
        }

        // Only specific measures changed — send partial update
        const measures: Record<string, unknown> = {}
        for (const idx of this._dirtyMeasures) {
            const measure = this.measures.find((m) => m.index === idx)
            if (measure) {
                measures[String(measure.index)] = new MeasureSerializer(measure).serialize()
            }
        }
        this.clearDirty()
        return { measures }
    }
}
