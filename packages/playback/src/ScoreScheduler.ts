import type { Note } from '@mushee/notation/model/Note'
import type { Score } from '@mushee/notation/model/Score'

import type { MidiPlayer } from './MidiPlayer'
import { type Tickable, Ticker } from './Ticker'

/** Where and when one note of the pass sits: times in seconds, positions in quarter beats. */
export interface TimelineEntry {
    /** Onset in seconds on the pass's clock (`MidiPlayer.currentTime`). */
    startTime: number
    /** Seconds from onset to the note's written end (a tie chain's held sound is not included). */
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
 *
 * Times come from the score's one clock (`Score.secondsAt`), measured from the
 * pass's start position, so the notes, the metronome and MIDI export agree on
 * every tempo marking wherever a pass starts.
 */
export class ScoreScheduler implements Tickable {
    score: Score | null = null
    /** Note to begin playback from on the next pass. Null = start of score. */
    startNote: Note | null = null
    readonly entries: TimelineEntry[] = []

    private midiPlayer: Pick<MidiPlayer, 'currentTime' | 'schedule'>
    private measureIdx = 0
    private noteIdx = 0
    /** Score time (`Score.secondsAt`) of the pass's start position; the pass clock reads 0 there. */
    private origin = 0
    private nextNoteTime = 0
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
        // The top of the score is second 0 on the score's clock.
        this.origin = 0
        this.nextNoteTime = 0
        this._done = false
        this.entries.length = 0

        // Start from the selected note when one is set; otherwise at the top of the score.
        const start = this.startNote
        if (this.score && start && start.measure.score === this.score) {
            this.measureIdx = start.measure.index
            this.noteIdx = Math.max(0, start.measure.notes.indexOf(start))
            this.origin = this.score.secondsAt(start.measure, start.measure.beatOffsetOf(start))
        }
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
        const beatSpan = note.duration.effectiveBeats
        const startTime = score.secondsAt(measure, beat) - this.origin
        const endTime = score.secondsAt(measure, beat + beatSpan) - this.origin

        // A tie continuation is not re-struck: the chain's first note holds through it
        // (Score.tiedBeats counts only real partners, so a dangling tie mark doesn't extend it).
        if (note.pitch && !note.tiesBack) {
            this.midiPlayer.schedule({
                startTime,
                duration: score.secondsAt(measure, beat + score.tiedBeats(note)) - this.origin - startTime,
                // Note pitch is the written pitch (MusicXML semantics); the instrument sounds it transposed.
                midi: score.instrument.soundingMidi(note.pitch),
                instrument: score.instrument,
            })
        }

        this.entries.push({ startTime, duration: endTime - startTime, beatSpan, measureIndex: this.measureIdx, beat })

        this.nextNoteTime = endTime
        this.noteIdx++
        return true
    }
}
