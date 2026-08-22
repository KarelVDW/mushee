import type { Note } from '@mushee/notation/model/Note'
import type { Score } from '@mushee/notation/model/Score'

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
    /** Note to begin playback from on the next pass. Null = start of score. */
    startNote: Note | null = null
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

        if (!this.score) return

        // Start from the selected note when one is set, seeding the tempo prevailing there
        // (it may carry over from an earlier measure); otherwise start at the top of the score.
        const start = this.startNote
        if (start && start.measure.score === this.score) {
            this.measureIdx = start.measure.index
            this.noteIdx = Math.max(0, start.measure.notes.indexOf(start))
            this.bpm = this.score.bpmAt(start)
            return
        }

        const tempo = this.score.firstMeasure?.tempoAtBeat(0)
        if (tempo) this.bpm = tempo.bpm
    }

    tick(): boolean {
        if (!this.score || this._done) return true
        const elapsed = this.midiPlayer.currentTime

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
                // Note pitch is the written pitch (MusicXML semantics); convert to sounding for playback.
                midi = note.pitch.toMidi() + this.score.instrument.chromaticTranspose
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
                    instrument: this.score.instrument,
                })
            }

            this.entries.push({
                startTime: this.nextNoteTime,
                duration: durationSecs,
                beatSpan,
                measureIndex: this.measureIdx,
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
