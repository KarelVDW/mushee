import type { Note } from '@/model/Note'
import type { Score } from '@/model/Score'

import { MidiPlayer } from './MidiPlayer'
import type { Tickable } from './Ticker'

const DEFAULT_BPM = 90
const LOOK_AHEAD = 0.05

export interface TimelineEntry {
    startTime: number
    duration: number
    beatSpan: number
    measureIndex: number
    beat: number
}

export class ScoreScheduler implements Tickable {
    score: Score | null = null
    readonly entries: TimelineEntry[] = []

    private midiPlayer: MidiPlayer
    private measureIdx = 0
    private noteIdx = 0
    private nextNoteTime = 0
    private bpm = DEFAULT_BPM
    private _done = false

    constructor(midiPlayer: MidiPlayer) {
        this.midiPlayer = midiPlayer
    }

    /** Time at which the last note ends, or -1 if still scheduling. */
    get endTime(): number {
        return this._done ? this.nextNoteTime : -1
    }

    reset() {
        this.measureIdx = 0
        this.noteIdx = 0
        this.nextNoteTime = 0
        this.bpm = DEFAULT_BPM
        this._done = false
        this.entries.length = 0

        if (this.score) {
            const firstMeasure = this.score.firstMeasure
            if (firstMeasure) {
                const tempo = firstMeasure.tempoAtBeat(0)
                if (tempo) this.bpm = tempo.bpm
            }
        }
    }

    tick(elapsed: number): boolean {
        if (!this.score || this._done) return true

        while (this.nextNoteTime <= elapsed + LOOK_AHEAD) {
            const measure = this.score.measures[this.measureIdx]
            if (!measure) {
                this._done = true
                return true
            }

            const notes = measure.notes
            if (this.noteIdx >= notes.length) {
                this.measureIdx++
                this.noteIdx = 0
                continue
            }

            const note = notes[this.noteIdx]
            const beat = measure.beatOffsetOf(note)

            if (this.noteIdx === 0) {
                const tempo = measure.tempoAtBeat(0)
                if (tempo) this.bpm = tempo.bpm
            }

            if (beat > 0) {
                const tempo = measure.tempoAtBeat(beat)
                if (tempo) this.bpm = tempo.bpm
            }

            const beatSpan = note.duration.effectiveBeats
            const durationSecs = (beatSpan * 60) / this.bpm

            let midi: number | undefined
            if (note.pitch && !note.tiesBack) {
                midi = note.pitch.toMidi()
            }

            let audioDuration: number | undefined
            if (midi !== undefined && note.tiesForward) {
                audioDuration = this.getTiedAudioDuration(note, durationSecs, this.bpm)
            }

            if (midi !== undefined) {
                this.midiPlayer.schedule({
                    startTime: this.nextNoteTime,
                    duration: audioDuration ?? durationSecs,
                    midi,
                })
            }

            this.entries.push({
                startTime: this.nextNoteTime,
                duration: durationSecs,
                beatSpan,
                measureIndex: measure.index,
                beat,
            })

            this.nextNoteTime += durationSecs
            this.noteIdx++
        }

        return false
    }

    private getTiedAudioDuration(note: Note, baseDuration: number, bpm: number): number {
        let total = baseDuration
        let current: Note | null = note
        while (current?.tiesForward) {
            const next = current.getNext()
            if (!next) break
            total += (next.duration.effectiveBeats * 60) / bpm
            current = next
        }
        return total
    }
}
