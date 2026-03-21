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
    TieType,
} from '@/components/notation/types'

const DIVISIONS = 12 // divisions per quarter note

import { Duration } from './Duration'
import { KeySignature } from './KeySignature'
import { ScoreLayout, ScoreLayoutOptions } from './layout/ScoreLayout'
import { Measure } from './Measure'
import { Note } from './Note'
import { Pitch } from './Pitch'
import { TimeSignature } from './TimeSignature'

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
                    newNotes.push(...Duration.fromBeats(freeBeats).map((d) => new Note({ duration: d, pitch: note.pitch, tie: 'start' })))
                    freeBeats = 0
                    remainderNotes = Duration.fromBeats(note.duration.effectiveBeats - freeBeats).map(
                        (d) => new Note({ duration: d, pitch: note.pitch, tie: 'start' }),
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
            let timeSignature: TimeSignature | undefined
            let keySignature: KeySignature | undefined
            let endBarline: BarlineType | undefined
            let pendingTempo: number | undefined
            const notes: Note[] = []
            const tempos: Array<{ noteIndex: number; bpm: number }> = []

            for (const entry of mxmlMeasure.entries) {
                switch (entry._type) {
                    case 'attributes': {
                        const c = entry.clef?.[0]
                        if (c) clef = Score.mxmlClefToClef(c.sign, c.line)
                        const t = entry.time?.[0]
                        if (t) timeSignature = new TimeSignature(Number(t.beats), Number(t.beatType))
                        const k = entry.key?.[0]
                        if (k) keySignature = new KeySignature(k.fifths, k.mode)
                        break
                    }
                    case 'barline': {
                        if (entry.barStyle) endBarline = Score.mxmlBarStyleToBarlineType(entry.barStyle)
                        break
                    }
                    case 'direction': {
                        if (entry.sound?.tempo !== undefined) pendingTempo = entry.sound.tempo
                        break
                    }
                    case 'note': {
                        if (pendingTempo !== undefined) {
                            tempos.push({ noteIndex: notes.length, bpm: pendingTempo })
                            pendingTempo = undefined
                        }
                        const pitch = entry.pitch
                            ? new Pitch({
                                  name: entry.pitch.step,
                                  alter: entry.pitch.alter ?? 0,
                                  accidental: Score.alterToAccidental(entry.pitch.alter),
                                  octave: entry.pitch.octave,
                              })
                            : undefined
                        const ratio = entry.timeModification
                            ? { actualNotes: entry.timeModification.actualNotes, normalNotes: entry.timeModification.normalNotes }
                            : undefined
                        const tie = Score.mxmlTieToTieType(entry.tie)
                        notes.push(
                            new Note({
                                duration: new Duration({
                                    type: entry.type ? Score.mxmlNoteTypeToDurationType(entry.type) : 'q',
                                    dots: entry.dot,
                                    ratio,
                                }),
                                pitch,
                                tie,
                            }),
                        )
                        break
                    }
                }
            }

            const measure = new Measure(score, mi, { clef, timeSignature, keySignature, endBarline })
            if (notes.length > 0) measure.addNotes(notes)
            for (const { noteIndex, bpm } of tempos) {
                const note = notes[noteIndex]
                if (note) measure.addTempo(measure.beatOffsetOf(note), bpm)
            }
            score.measures.push(measure)
        }
        return score
    }

    toInput(): ScorePartwise {
        const measures = this.measures.map((measure, mi) => {
            const entries: MxmlMeasureEntry[] = []

            if (measure.clef || measure.timeSignature || measure.keySignature) {
                entries.push({
                    _type: 'attributes' as const,
                    divisions: DIVISIONS,
                    ...(measure.clef && { clef: [Score.clefToMxmlClef(measure.clef)] }),
                    ...(measure.timeSignature && { time: [Score.timeSignatureToMxmlTime(measure.timeSignature)] }),
                    ...(measure.keySignature && {
                        key: [{ fifths: measure.keySignature.fifths, ...(measure.keySignature.mode && { mode: measure.keySignature.mode }) }],
                    }),
                })
            }

            for (const note of measure.notes) {
                const tempoAtBeat = measure.tempoAtBeat(measure.beatOffsetOf(note))
                if (tempoAtBeat) {
                    entries.push({ _type: 'direction' as const, sound: { tempo: tempoAtBeat.bpm } })
                }
                entries.push({
                    _type: 'note' as const,
                    ...(note.pitch
                        ? {
                              pitch: {
                                  step: note.pitch.name as MxmlStep,
                                  ...(note.pitch.alter !== 0 && { alter: note.pitch.alter }),
                                  octave: note.pitch.octave,
                              },
                          }
                        : { rest: {} }),
                    duration: Score.computeDivisions(note),
                    voice: '1',
                    type: Score.durationTypeToMxmlNoteType(note.duration.type),
                    ...(note.duration.dots > 0 && { dot: note.duration.dots }),
                    ...(note.tie && { tie: Score.tieTypeToMxmlTie(note.tie) }),
                    ...(note.inTuplet && {
                        timeModification: {
                            actualNotes: note.duration.ratio.actualNotes,
                            normalNotes: note.duration.ratio.normalNotes,
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

    private static timeSignatureToMxmlTime(ts: TimeSignature): { beats: string; beatType: string } {
        return { beats: String(ts.beats), beatType: String(ts.beatType) }
    }

    private static mxmlTieToTieType(ties: Array<{ type: 'start' | 'stop' }> | undefined): TieType | undefined {
        if (!ties?.length) return undefined
        const hasStart = ties.some((t) => t.type === 'start')
        const hasStop = ties.some((t) => t.type === 'stop')
        if (hasStart && hasStop) return 'start-stop'
        if (hasStart) return 'start'
        if (hasStop) return 'stop'
        return undefined
    }

    private static tieTypeToMxmlTie(tie: TieType): Array<{ type: 'start' | 'stop' }> {
        switch (tie) {
            case 'start':
                return [{ type: 'start' }]
            case 'stop':
                return [{ type: 'stop' }]
            case 'start-stop':
                return [{ type: 'stop' }, { type: 'start' }]
        }
    }

    private static computeDivisions(note: Note): number {
        const base: Record<DurationType, number> = { w: 48, h: 24, q: 12, '8': 6, '16': 3 }
        let dur = base[note.duration.type]
        if (note.duration.dots > 0) dur = dur * (2 - 1 / Math.pow(2, note.duration.dots))
        if (note.inTuplet) dur = dur * (note.duration.ratio.normalNotes / note.duration.ratio.actualNotes)
        return Math.round(dur)
    }
}
