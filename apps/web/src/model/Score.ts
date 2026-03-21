import { compact, groupBy, keyBy, last, sumBy } from 'lodash-es'

import type {
    BarlineType,
    Clef,
    DurationType,
    MxmlBarStyle,
    MxmlClefSign,
    MxmlMeasureEntry,
    MxmlNoteType,
    MxmlStep,
    ScorePartwise,
} from '@/components/notation/types'

const DIVISIONS = 12 // divisions per quarter note

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

    static fromInput(input: ScorePartwise, onChange?: () => void): Score {
        const score = new Score(onChange)
        const part = input.parts[0]
        if (!part) return score

        for (let mi = 0; mi < part.measures.length; mi++) {
            const mxmlMeasure = part.measures[mi]
            let clef: Clef | undefined
            let timeSignature: string | undefined
            let endBarline: BarlineType | undefined
            let tempo: number | undefined
            const notes: Note[] = []

            for (const entry of mxmlMeasure.entries) {
                switch (entry._type) {
                    case 'attributes': {
                        const c = entry.clef?.[0]
                        if (c) clef = Score.mxmlClefToClef(c.sign, c.line)
                        const t = entry.time?.[0]
                        if (t) timeSignature = `${t.beats}/${t.beatType}`
                        break
                    }
                    case 'barline': {
                        if (entry.barStyle) endBarline = Score.mxmlBarStyleToBarlineType(entry.barStyle)
                        break
                    }
                    case 'direction': {
                        if (entry.sound?.tempo !== undefined) tempo = entry.sound.tempo
                        break
                    }
                    case 'note': {
                        const pitch = entry.pitch
                            ? new Pitch({
                                  name: entry.pitch.step,
                                  accidental: Score.alterToAccidental(entry.pitch.alter),
                                  octave: entry.pitch.octave,
                              })
                            : undefined
                        const ratio = entry.timeModification
                            ? { numerator: entry.timeModification.normalNotes, denominator: entry.timeModification.actualNotes }
                            : undefined
                        const hasTieStart = entry.tie?.some((t) => t.type === 'start') ?? false
                        notes.push(
                            new Note({
                                duration: new Duration({
                                    type: entry.type ? Score.mxmlNoteTypeToDurationType(entry.type) : 'q',
                                    dots: entry.dot,
                                    ratio,
                                }),
                                pitch,
                                tie: hasTieStart,
                                tempo,
                            }),
                        )
                        tempo = undefined
                        break
                    }
                }
            }

            const measure = new Measure(score, mi, { clef, timeSignature, endBarline })
            if (notes.length > 0) measure.addNotes(notes)
            score.measures.push(measure)
        }
        return score
    }

    toInput(): ScorePartwise {
        const measures = this.measures.map((measure, mi) => {
            const entries: MxmlMeasureEntry[] = []

            if (measure.clef || measure.timeSignature) {
                entries.push({
                    _type: 'attributes' as const,
                    divisions: DIVISIONS,
                    ...(measure.clef && { clef: [Score.clefToMxmlClef(measure.clef)] }),
                    ...(measure.timeSignature && { time: [Score.timeSignatureToMxmlTime(measure.timeSignature)] }),
                })
            }

            for (const note of measure.notes) {
                if (note.tempo !== undefined) {
                    entries.push({ _type: 'direction' as const, sound: { tempo: note.tempo.bpm } })
                }
                entries.push({
                    _type: 'note' as const,
                    ...(note.pitch
                        ? {
                              pitch: {
                                  step: note.pitch.name as MxmlStep,
                                  ...(note.pitch.accidental && { alter: Score.accidentalToAlter(note.pitch.accidental) }),
                                  octave: note.pitch.octave,
                              },
                          }
                        : { rest: {} }),
                    duration: Score.computeDivisions(note),
                    voice: '1',
                    type: Score.durationTypeToMxmlNoteType(note.duration.type),
                    ...(note.duration.dots > 0 && { dot: note.duration.dots }),
                    ...(note.tie && { tie: [{ type: 'start' as const }] }),
                    ...(note.inTuplet && {
                        timeModification: {
                            actualNotes: note.duration.ratio.denominator,
                            normalNotes: note.duration.ratio.numerator,
                        },
                    }),
                })
            }

            if (measure.endBarline && measure.endBarline !== 'single') {
                entries.push({
                    _type: 'barline' as const,
                    location: 'right' as const,
                    barStyle: Score.barlineTypeToMxmlBarStyle(measure.endBarline),
                })
            }

            return { number: String(mi + 1), entries }
        })

        return {
            partList: { scoreParts: [{ id: 'P1', partName: 'Part 1' }] },
            parts: [{ id: 'P1', measures }],
        }
    }

    // --- MusicXML ↔ Internal type conversions ---

    private static readonly NOTE_TYPE_MAP: Record<MxmlNoteType, DurationType> = {
        whole: 'w',
        half: 'h',
        quarter: 'q',
        eighth: '8',
        '16th': '16',
    }

    private static readonly DURATION_TYPE_MAP: Record<DurationType, MxmlNoteType> = {
        w: 'whole',
        h: 'half',
        q: 'quarter',
        '8': 'eighth',
        '16': '16th',
    }

    private static mxmlNoteTypeToDurationType(type: MxmlNoteType): DurationType {
        return Score.NOTE_TYPE_MAP[type]
    }

    private static durationTypeToMxmlNoteType(type: DurationType): MxmlNoteType {
        return Score.DURATION_TYPE_MAP[type]
    }

    private static alterToAccidental(alter: number | undefined): string | undefined {
        switch (alter) {
            case 1:
                return '#'
            case -1:
                return 'b'
            case 2:
                return '##'
            case -2:
                return 'bb'
            default:
                return undefined
        }
    }

    private static accidentalToAlter(accidental: string): number {
        switch (accidental) {
            case '#':
                return 1
            case 'b':
                return -1
            case '##':
                return 2
            case 'bb':
                return -2
            case 'n':
                return 0
            default:
                return 0
        }
    }

    private static mxmlClefToClef(sign: string, line?: number): Clef {
        if (sign === 'F' && (line === 4 || line === undefined)) return 'bass'
        return 'treble'
    }

    private static clefToMxmlClef(clef: Clef): { sign: MxmlClefSign; line: number } {
        return clef === 'bass' ? { sign: 'F', line: 4 } : { sign: 'G', line: 2 }
    }

    private static mxmlBarStyleToBarlineType(style: MxmlBarStyle): BarlineType {
        switch (style) {
            case 'light-light':
                return 'double'
            case 'light-heavy':
                return 'end'
            case 'none':
                return 'none'
            default:
                return 'single'
        }
    }

    private static barlineTypeToMxmlBarStyle(type: BarlineType): MxmlBarStyle {
        switch (type) {
            case 'double':
                return 'light-light'
            case 'end':
                return 'light-heavy'
            case 'none':
                return 'none'
            default:
                return 'regular'
        }
    }

    private static timeSignatureToMxmlTime(ts: string): { beats: string; beatType: string } {
        const [beats, beatType] = ts.split('/')
        return { beats, beatType }
    }

    private static computeDivisions(note: Note): number {
        const base: Record<DurationType, number> = { w: 48, h: 24, q: 12, '8': 6, '16': 3 }
        let dur = base[note.duration.type]
        if (note.duration.dots > 0) dur = dur * (2 - 1 / Math.pow(2, note.duration.dots))
        if (note.inTuplet) dur = dur * (note.duration.ratio.numerator / note.duration.ratio.denominator)
        return Math.round(dur)
    }
}
