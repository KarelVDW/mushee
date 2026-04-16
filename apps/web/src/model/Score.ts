import { compact, groupBy, keyBy, last, sumBy } from 'lodash-es'

import { Duration } from './Duration'
import { ScoreLayout } from './layout/ScoreLayout'
import { Measure } from './Measure'
import { Note } from './Note'
import { TimeSignature } from './TimeSignature'
import { MeasureSerializer } from './util/ScoreSerializer'

export class Score {
    readonly measures: Measure[] = []
    private _layout: ScoreLayout | null = null
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

    /** Resolve the active time signature at a given measure index by walking backwards. */
    getActiveTimeSignature(measureIndex: number): TimeSignature | undefined {
        for (let i = measureIndex; i >= 0; i--) {
            const ts = this.measures[i].timeSignature
            if (ts) return ts
        }
        return undefined
    }

    noteById(id: string): Note | null {
        for (const measure of this.measures) {
            for (const note of measure.notes) {
                if (note.id === id) return note
            }
        }
        return null
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

    addMeasure() {
        const measure = new Measure(this, this.measures.length)
        last(this.measures)?.setEndBarline('single')
        measure.setEndBarline('end')
        this.measures.push(measure)
        this.markStructureChanged()
        this.onChange()
        return measure
    }

    removeLastMeasure() {
        this.measures.splice(this.measures.length - 1, 1)
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
