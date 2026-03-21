import { compact, groupBy, keyBy, last, sumBy } from 'lodash-es'

import type { ScoreInput, TupletInput } from '@/components/notation'

import { Duration } from './Duration'
import { ScoreLayout, ScoreLayoutOptions } from './layout/ScoreLayout'
import { Measure } from './Measure'
import { Note } from './Note'
import { Pitch } from './Pitch'

export class Score {
    private _touchedAt: number
    readonly measures: Measure[] = []
    private _layout: ScoreLayout | undefined
    private onChange: () => void

    constructor(onChange?: () => void) {
        this.onChange = () => {
            this.touch()
            onChange?.()
        }
        this._touchedAt = Date.now()
        // this.layout = new ScoreLayout(this)
    }

    get layout() {
        if (!this._layout) throw new Error('ScoreLayout has not yet been initialized')
        return this._layout
    }

    initializeLayout(options: ScoreLayoutOptions) {
        this._layout = new ScoreLayout(this, options)
    }

    get touchedAt() {
        return this._touchedAt
    }

    touch() {
        this._touchedAt = Date.now()
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
        this.measures.splice(this.measures.length, 0, measure)
        this.onChange()
        return measure
    }

    removeLastMeasure() {
        this.measures.splice(this.measures.length - 1, 1)
        last(this.measures)?.setEndBarline('end')
        this.onChange()
    }

    replace(targets: Note[], values: Note[]) {
        if (!targets.length) throw new Error('Replace targets can not be empty')
        if (!values.length) throw new Error('Replace values can not be empty')
        let targetBeats = sumBy(targets, (n) => n.duration.effectiveBeats)
        let valueBeats = sumBy(values, (n) => n.duration.effectiveBeats)
        console.log('replace', { targetBeats, valueBeats })

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
        console.log('replace2', { values })

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
                    newNotes.push(...Duration.fromBeats(freeBeats).map((d) => new Note({ duration: d, pitch: note.pitch, tie: true })))
                    freeBeats = 0
                    remainderNotes = Duration.fromBeats(note.duration.effectiveBeats - freeBeats).map(
                        (d) => new Note({ duration: d, pitch: note.pitch, tie: true }),
                    )
                }
            }
            measure.replaceNotes(notes, newNotes)
            replaceValues = [...remainderNotes, ...replaceValues]
        }
        this.onChange()
    }

    static fromInput(input: ScoreInput, onChange?: () => void): Score {
        const score = new Score(onChange)
        for (let mi = 0; mi < input.measures.length; mi++) {
            const measureInput = input.measures[mi]
            const measure = new Measure(score, mi, {
                clef: measureInput.clef,
                timeSignature: measureInput.timeSignature,
                endBarline: measureInput.endBarline,
            })
            const voice = measureInput.voices[0]
            if (!voice) {
                score.measures.push(measure)
                continue
            }
            const ratioMap = new Map<number, { numerator: number; denominator: number }>()
            for (const tuplet of voice.tuplets ?? []) {
                for (let j = 0; j < tuplet.count; j++) {
                    ratioMap.set(tuplet.startIndex + j, {
                        numerator: tuplet.notesOccupied ?? 2,
                        denominator: tuplet.count,
                    })
                }
            }
            const notes = voice.notes.map((noteInput, idx) => {
                const pitch = noteInput.keys.length > 0 ? new Pitch(noteInput.keys[0]) : undefined
                const ratio = ratioMap.get(idx)
                return new Note({
                    duration: new Duration({ type: noteInput.duration, dots: noteInput.dots, ratio }),
                    pitch,
                    tie: noteInput.tie,
                    tempo: noteInput.tempo,
                })
            })
            measure.addNotes(notes)
            score.measures.push(measure)
        }
        return score
    }

    toInput(): ScoreInput {
        return {
            measures: this.measures.map((measure) => ({
                clef: measure.clef,
                timeSignature: measure.timeSignature,
                endBarline: measure.endBarline,
                voices: [
                    {
                        notes: measure.notes.map((note) => ({
                            keys: note.pitch
                                ? [{ name: note.pitch.name, accidental: note.pitch.accidental, octave: note.pitch.octave }]
                                : [],
                            duration: note.duration.type,
                            ...(note.duration.dots > 0 && { dots: note.duration.dots }),
                            ...(note.tie && { tie: true }),
                            ...(note.tempo !== undefined && { tempo: note.tempo.bpm }),
                        })),
                        tuplets: this.extractTuplets(measure.notes),
                    },
                ],
            })),
        }
    }

    private extractTuplets(notes: Note[]): TupletInput[] {
        const tuplets: TupletInput[] = []
        let i = 0
        while (i < notes.length) {
            if (notes[i].inTuplet) {
                const { numerator, denominator } = notes[i].duration.ratio
                const startIndex = i
                let count = 0
                while (
                    i < notes.length &&
                    notes[i].duration.ratio.numerator === numerator &&
                    notes[i].duration.ratio.denominator === denominator
                ) {
                    count++
                    i++
                }
                tuplets.push({ startIndex, count, notesOccupied: numerator })
            } else {
                i++
            }
        }
        return tuplets
    }
}
