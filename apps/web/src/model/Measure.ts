import { difference, sumBy } from 'lodash-es'

import type { BarlineType, Clef } from '@/components/notation/types'

import { Duration } from './Duration'
import { Note } from './Note'
import type { Score } from './Score'

export class Measure {
    readonly id: string
    private _notes: Note[] = []
    private _clef?: Clef
    private _timeSignature?: string // e.g. '4/4', '3/4'
    private _endBarline?: BarlineType // default: 'single'
    private _tuplets: Array<Set<Note>> = []

    constructor(
        readonly score: Score,
        value?: {
            clef?: Clef
            timeSignature?: string // e.g. '4/4', '3/4'
            endBarline?: BarlineType // default: 'single'
        },
    ) {
        this.id = crypto.randomUUID()
        this._clef = value?.clef
        this._timeSignature = value?.timeSignature
        this._endBarline = value?.endBarline
    }

    get tuplets() {
        return this._tuplets
    }

    get notes() {
        return this._notes
    }

    get clef() {
        return this._clef
    }

    get timeSignature() {
        return this._timeSignature
    }

    get endBarline() {
        return this._endBarline
    }

    get firstNote(): Note | null {
        return this._notes[0] ?? null
    }

    get lastNote(): Note | null {
        return this._notes[this._notes.length - 1] ?? null
    }

    get beats(): number {
        return sumBy(this._notes, (n) => n.duration.effectiveBeats)
    }

    get maxBeats(): number {
        // for (let i = this.index; i >= 0; i--) {
        //     const ts = this.score.measures[i].timeSignature
        //     if (ts) {
        //         const [num, den] = ts.split('/').map(Number)
        //         return num * (4 / den)
        //     }
        // }
        return 4
    }

    setClef(clef: Clef | undefined) {
        this._clef = clef
    }

    setTimeSignature(timeSignature: string | undefined) {
        this._timeSignature = timeSignature
    }

    setEndBarline(barLine: BarlineType | undefined) {
        this._endBarline = barLine
    }

    getNextNote(note?: Note): Note | null {
        if (!note) return this.firstNote
        const idx = this._notes.indexOf(note)
        if (idx === -1 || idx >= this._notes.length - 1) return null
        return this._notes[idx + 1]
    }

    getPreviousNote(note: Note): Note | null {
        const idx = this._notes.indexOf(note)
        if (idx <= 0) return null
        return this._notes[idx - 1]
    }

    getNext(): Measure | null {
        return this.score.getNextMeasure(this)
    }

    getPrevious(): Measure | null {
        return this.score.getPreviousMeasure(this)
    }

    removeNotes(notes: Note[]) {
        this._notes = difference(this._notes, notes)
        notes.forEach((n) => n.setMeasure(undefined))
        this.findTuplets()
        return this
    }

    addNotes(notes: Note[], position: 'start' | 'end' = 'end') {
        this._notes = position === 'end' ? [...this._notes, ...notes] : [...notes, ...this._notes]
        notes.forEach((n) => n.setMeasure(this))
        this.findTuplets()
        return this
    }

    replaceNotes(targets: Note[], values: Note[]) {
        console.log('replaceNotes', { targets, values })
        if (!targets.length) throw new Error('Replace targets can not be empty')
        if (targets.some((n) => n.measure.id !== this.id)) throw new Error('Cannot replace notes not belonging to this measure')
        const startIndex = this.notes.findIndex((n) => n.id === targets[0].id)
        if (startIndex < 0) throw new Error('Cannot find startIndex for replace')
        const diff = difference(this._notes, targets)
        this._notes = [...diff.slice(0, startIndex), ...values, ...diff.slice(startIndex)]
        targets.forEach((n) => n.setMeasure(undefined))
        values.forEach((n) => n.setMeasure(this))
        this.findTuplets()
        return this
    }

    complete() {
        if (this.beats >= this.maxBeats) return
        this.addNotes(Duration.fromBeats(this.maxBeats - this.beats).map((d) => new Note({ duration: d })))
        return this
    }

    private findTuplets() {
        this._tuplets = []
        let currentSet = new Set<Note>()
        let currentRatio: { numerator: number; denominator: number } | null = null
        let totalDuration = 0

        for (const note of this._notes) {
            const { numerator, denominator } = note.duration.ratio

            // Ignore non-tuplet notes (ratio 1/1)
            if (numerator === 1 && denominator === 1) {
                if (currentSet.size > 0) {
                    this._tuplets.push(currentSet)
                    currentSet = new Set()
                    currentRatio = null
                    totalDuration = 0
                }
                continue
            }

            // Ratio changed — save current set and start fresh
            if (currentRatio && (currentRatio.numerator !== numerator || currentRatio.denominator !== denominator)) {
                if (currentSet.size > 0) {
                    this._tuplets.push(currentSet)
                }
                currentSet = new Set()
                totalDuration = 0
            }

            currentRatio = { numerator, denominator }
            currentSet.add(note)
            totalDuration += note.duration.effectiveBeats

            // Set is complete when total duration reaches the numerator
            if (totalDuration >= numerator - 0.001) {
                this._tuplets.push(currentSet)
                currentSet = new Set()
                currentRatio = null
                totalDuration = 0
            }
        }

        // Push any remaining incomplete set
        if (currentSet.size > 0) {
            this._tuplets.push(currentSet)
        }
    }
}
