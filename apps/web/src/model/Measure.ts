import { difference, sumBy } from 'lodash-es'

import type { BarlineType } from '@/components/notation/types'

import { Beam } from './Beam'
import { Clef } from './Clef'
import { Duration } from './Duration'
import type { KeySignature } from './KeySignature'
import { MeasureLayout } from './layout/MeasureLayout'
import { Note } from './Note'
import type { Score } from './Score'
import { Tempo } from './Tempo'
import type { TimeSignature } from './TimeSignature'
import { Tuplet } from './Tuplet'
import { BeamFinder } from './util/BeamFinder'
import { TupletFinder } from './util/TupletFinder'

export class Measure {
    private _notes: Note[] = []
    private _clef?: Clef
    private _timeSignature?: TimeSignature
    private _keySignature?: KeySignature
    private _endBarline?: BarlineType
    private _tempos: Tempo[] = []
    private _tuplets: Tuplet[] = []
    private _beams: Beam[] = []
    private _beatOffsets = new Map<Note, number>()
    private _tupletByNote = new Map<Note, Tuplet>()
    private _beamByNote = new Map<Note, Beam>()
    private _layout: MeasureLayout | null = null

    constructor(
        readonly score: Score,
        readonly index: number,
        value?: {
            timeSignature?: TimeSignature
            keySignature?: KeySignature
            endBarline?: BarlineType
        },
    ) {
        this._timeSignature = value?.timeSignature
        this._keySignature = value?.keySignature
        this._endBarline = value?.endBarline
    }

    setClef(clef: Clef | undefined) {
        this._clef = clef
        this._clef?.setMeasure(this)
    }

    get layout() {
        this._layout ||= new MeasureLayout(this)
        return this._layout
    }

    get tuplets() {
        return this._tuplets
    }

    get beams() {
        return this._beams
    }

    beatOffsetOf(note: Note): number {
        const offset = this._beatOffsets.get(note)
        if (offset === undefined) throw new Error('Note does not belong to this measure')
        return offset
    }

    tupletGroupOf(note: Note): Tuplet | undefined {
        return this._tupletByNote.get(note)
    }

    beamOf(note: Note): Beam | undefined {
        return this._beamByNote.get(note)
    }

    /** Find the note whose beat range contains the given (continuous) beat value. */
    noteAtBeat(beat: number): Note | null {
        for (let i = this._notes.length - 1; i >= 0; i--) {
            const note = this._notes[i]
            const offset = this._beatOffsets.get(note)
            if (offset !== undefined && offset <= beat) return note
        }
        return null
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

    get keySignature() {
        return this._keySignature
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
        return this.score.getActiveTimeSignature(this.index)?.maxBeats ?? 4
    }

    setTimeSignature(timeSignature: TimeSignature | undefined) {
        this._timeSignature = timeSignature
    }

    setKeySignature(keySignature: KeySignature | undefined) {
        this._keySignature = keySignature
    }

    setEndBarline(barLine: BarlineType | undefined) {
        this._endBarline = barLine
    }

    get tempos(): Tempo[] {
        return this._tempos
    }

    addTempo(beatPosition: number, bpm: number) {
        this._tempos.push(new Tempo(this, beatPosition, bpm))
    }

    removeTempo(beatPosition: number) {
        this._tempos = this._tempos.filter((t) => t.beatPosition !== beatPosition)
    }

    setTempo(beatPosition: number, bpm: number) {
        this.removeTempo(beatPosition)
        this.addTempo(beatPosition, bpm)
    }

    tempoAtBeat(beatPosition: number): Tempo | undefined {
        return this._tempos.find((t) => t.beatPosition === beatPosition)
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
        if (targets.some((n) => n.measure.index !== this.index)) throw new Error('Cannot replace notes not belonging to this measure')
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
        // find beat offsets
        this._beatOffsets = new Map()
        let beat = 0
        for (const note of this._notes) {
            this._beatOffsets.set(note, beat)
            beat += note.duration.effectiveBeats
        }
        // find tuplets
        const tupletFinder = new TupletFinder(this)
        this._tuplets = tupletFinder.tuplets
        this._tupletByNote = tupletFinder.tupletByNote
        // find beams
        const beamFinder = new BeamFinder(this)
        this._beams = beamFinder.beams
        this._beamByNote = beamFinder.beamByNote
        // invalidate layout
        this._layout = null
    }
}
