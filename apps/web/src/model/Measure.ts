import { difference, sumBy } from 'lodash-es'

import type { BarlineType, Clef } from '@/components/notation/types'

import { Duration } from './Duration'
import { Note } from './Note'
import type { Score } from './Score'

export interface BeamGroup {
    notes: Set<Note>
    stemDir: 'up' | 'down'
}

export class Measure {
    readonly id: string
    private _notes: Note[] = []
    private _clef?: Clef
    private _timeSignature?: string // e.g. '4/4', '3/4'
    private _endBarline?: BarlineType // default: 'single'
    private _tuplets: Array<Set<Note>> = []
    private _beamGroups: BeamGroup[] = []
    private _beatOffsets = new Map<Note, number>()
    private _tupletByNote = new Map<Note, Set<Note>>()
    private _beamGroupByNote = new Map<Note, BeamGroup>()

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

    get beamGroups() {
        return this._beamGroups
    }

    beatOffsetOf(note: Note): number {
        const offset = this._beatOffsets.get(note)
        if (offset === undefined) throw new Error('Note does not belong to this measure')
        return offset
    }

    tupletGroupOf(note: Note): Set<Note> | undefined {
        return this._tupletByNote.get(note)
    }

    beamGroupOf(note: Note): BeamGroup | undefined {
        return this._beamGroupByNote.get(note)
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
        this.recompute()
        return this
    }

    addNotes(notes: Note[], position: 'start' | 'end' = 'end') {
        this._notes = position === 'end' ? [...this._notes, ...notes] : [...notes, ...this._notes]
        notes.forEach((n) => n.setMeasure(this))
        this.recompute()
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
        this.recompute()
        return this
    }

    complete() {
        if (this.beats >= this.maxBeats) return
        this.addNotes(Duration.fromBeats(this.maxBeats - this.beats).map((d) => new Note({ duration: d })))
        return this
    }

    private recompute() {
        this.findBeatOffsets()
        this.findTuplets()
        this.findBeamGroups()
    }

    private findBeatOffsets() {
        this._beatOffsets = new Map()
        let beat = 0
        for (const note of this._notes) {
            this._beatOffsets.set(note, beat)
            beat += note.duration.effectiveBeats
        }
    }

    private findTuplets() {
        this._tuplets = []
        this._tupletByNote = new Map()
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

        // Build reverse lookup
        for (const set of this._tuplets) {
            for (const note of set) {
                this._tupletByNote.set(note, set)
            }
        }
    }

    /**
     * Group consecutive beamable notes (8th, 16th) that fall within the same beat,
     * and compute a uniform stem direction per group based on average pitch.
     * Beat boundaries break groups, unless both notes belong to the same tuplet.
     */
    private findBeamGroups() {
        this._beamGroups = []
        this._beamGroupByNote = new Map()
        let currentNotes: Note[] = []
        let beat = 0

        const flushGroup = () => {
            if (currentNotes.length >= 2) {
                const avgLine = currentNotes.reduce((sum, n) => sum + (n.pitch?.line ?? 0), 0) / currentNotes.length
                const stemDir: 'up' | 'down' = avgLine >= 3 ? 'down' : 'up'
                const group: BeamGroup = { notes: new Set(currentNotes), stemDir }
                this._beamGroups.push(group)
                for (const n of currentNotes) {
                    this._beamGroupByNote.set(n, group)
                }
            }
            currentNotes = []
        }

        for (const note of this._notes) {
            if (!note.duration.isBeamable || note.isRest) {
                flushGroup()
                beat += note.duration.effectiveBeats
                continue
            }

            if (currentNotes.length > 0) {
                const prevNote = currentNotes[currentNotes.length - 1]
                const prevTuplet = this._tupletByNote.get(prevNote)
                const sameTuplet = prevTuplet !== undefined && prevTuplet === this._tupletByNote.get(note)

                if (!sameTuplet) {
                    const eitherInTuplet = prevNote.inTuplet || note.inTuplet
                    if (eitherInTuplet) {
                        flushGroup()
                    } else {
                        const prevBeat = beat - prevNote.duration.effectiveBeats
                        const prevBeatBoundary = Math.floor(prevBeat)
                        const nextBeatBoundary = Math.floor(beat)

                        if (nextBeatBoundary > prevBeatBoundary) {
                            flushGroup()
                        }
                    }
                }
            }

            currentNotes.push(note)
            beat += note.duration.effectiveBeats
        }

        flushGroup()
    }
}
