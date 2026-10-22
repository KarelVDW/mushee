import type { Note } from '@mushee/notation/model/Note'
import type { Score } from '@mushee/notation/model/Score'

import type { MidiPlayer } from './MidiPlayer'
import { type Tickable, Ticker } from './Ticker'

const DEFAULT_BPM = 90

/** Where and when one note of the pass sits: times in seconds, positions in quarter beats. */
export interface TimelineEntry {
    /** Onset in seconds on the pass's clock (`MidiPlayer.currentTime`). */
    startTime: number
    /** Written length in seconds at the prevailing tempo (a tie chain's held sound is not included). */
    duration: number
    /** Written length in quarter beats. */
    beatSpan: number
    /** Index of the note's measure in the score. */
    measureIndex: number
    /** Onset within its measure, in quarter beats. */
    beat: number
}

/**
 * Plays a score through a MidiPlayer by look-ahead scheduling: each tick walks
 * the score note by note and hands every note due before
 * `MidiPlayer.currentTime + Ticker.LOOK_AHEAD` to the player. Every note —
 * rests and tie continuations included — also gets a timeline entry, so the
 * playback cursor advances over notes that make no sound.
 */
export class ScoreScheduler implements Tickable {
    score: Score | null = null
    /** Note to begin playback from on the next pass. Null = start of score. */
    startNote: Note | null = null
    readonly entries: TimelineEntry[] = []

    private midiPlayer: Pick<MidiPlayer, 'currentTime' | 'schedule'>
    private measureIdx = 0
    private noteIdx = 0
    private nextNoteTime = 0
    private bpm = DEFAULT_BPM
    private _done = false

    constructor(midiPlayer: Pick<MidiPlayer, 'currentTime' | 'schedule'>) {
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
        const horizon = this.midiPlayer.currentTime + Ticker.LOOK_AHEAD
        while (this.nextNoteTime <= horizon) {
            if (!this.step(this.score)) {
                this._done = true
                return true
            }
        }
        return false
    }

    /**
     * Schedule the note at the walk position if it sounds, record its timeline
     * entry, and advance. Returns false once the score is exhausted.
     */
    private step(score: Score): boolean {
        const measure = score.measures[this.measureIdx]
        if (!measure) return false

        const notes = measure.notes
        if (this.noteIdx >= notes.length) {
            this.measureIdx++
            this.noteIdx = 0
            return true
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
            midi = note.pitch.toMidi() + score.instrument.chromaticTranspose
        }

        let audioDuration: number | undefined
        if (midi !== undefined && score.tiePartner(note)) {
            audioDuration = this.getTiedAudioDuration(note, durationSecs, this.bpm)
        }

        if (midi !== undefined) {
            this.midiPlayer.schedule({
                startTime: this.nextNoteTime,
                duration: audioDuration ?? durationSecs,
                midi,
                instrument: score.instrument,
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
        return true
    }

    private getTiedAudioDuration(note: Note, baseDuration: number, bpm: number): number {
        let total = baseDuration
        // Only real tie partners (same sounding pitch) extend the sound; a dangling tie mark does not.
        for (let partner = this.score?.tiePartner(note) ?? null; partner; partner = this.score?.tiePartner(partner) ?? null) {
            total += (partner.duration.effectiveBeats * 60) / bpm
        }
        return total
    }
}
