import type { Note } from '@mushee/notation/model/Note'
import type { Score } from '@mushee/notation/model/Score'

import type { MidiPlayer } from './MidiPlayer'
import { PassClock } from './PassClock'
import { type Tickable, Ticker } from './Ticker'

/** Where and when one note of the pass sits: times in seconds, positions in quarter beats. */
interface TimelineEntry {
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
 * every tempo marking wherever a pass starts. The pass reads it through its
 * {@link clock}, which keeps the pass in step when the score is edited mid-pass.
 */
export class ScoreScheduler implements Tickable {
    private score: Score | null = null
    private startNote: Note | null = null
    /** Every note walked so far this pass, in onset order. */
    private readonly entries: TimelineEntry[] = []

    /** The clock this scheduler's passes run on; cue a Metronome with it so the clicks keep to the notes. */
    readonly clock: PassClock

    private midiPlayer: Pick<MidiPlayer, 'currentTime' | 'schedule'>
    private measureIdx = 0
    private noteIdx = 0
    /** Score position the walk has reached: the end of the last walked note, or the start position. */
    private walkEnd = { measureIndex: 0, beat: 0 }
    private _done = false

    constructor(midiPlayer: Pick<MidiPlayer, 'currentTime' | 'schedule'>) {
        this.midiPlayer = midiPlayer
        this.clock = new PassClock(midiPlayer)
    }

    /**
     * Set up the next pass: play `score` from `startNote`, or from the top when
     * it is null (or belongs to another score). The pass begins on the next
     * reset() (Ticker.play).
     */
    cue(score: Score, startNote: Note | null = null): void {
        this.score = score
        this.startNote = startNote
    }

    /**
     * Where the pass is at `elapsed` seconds on its clock: the measure of the
     * latest note that has begun and the beat interpolated through it (held at
     * its end until the next onset). Null before the first onset.
     */
    positionAt(elapsed: number): { measureIndex: number; beat: number } | null {
        let current: TimelineEntry | null = null
        for (let i = this.entries.length - 1; i >= 0; i--) {
            if (this.entries[i].startTime <= elapsed) {
                current = this.entries[i]
                break
            }
        }
        if (!current) return null

        const progress = Math.min(1, (elapsed - current.startTime) / current.duration)
        return { measureIndex: current.measureIndex, beat: current.beat + current.beatSpan * progress }
    }

    /** Whether the pass has played out by `elapsed`: every note is scheduled and the last one has ended. */
    hasFinishedAt(elapsed: number): boolean {
        return this._done && elapsed >= this.walkTime
    }

    /** Pass time the walk has reached — read fresh, as an edit mid-pass re-anchors the clock. */
    private get walkTime(): number {
        return this.clock.timeAt(this.walkEnd.measureIndex, this.walkEnd.beat)
    }

    reset() {
        this.measureIdx = 0
        this.noteIdx = 0
        this.walkEnd = { measureIndex: 0, beat: 0 }
        this._done = false
        this.entries.length = 0
        if (!this.score) return

        // Start from the selected note when one is set; otherwise at the top of the score.
        const start = this.startNote
        if (start && start.measure.score === this.score) {
            this.measureIdx = start.measure.index
            this.noteIdx = Math.max(0, start.measure.notes.indexOf(start))
            this.walkEnd = { measureIndex: this.measureIdx, beat: start.measure.beatOffsetOf(start) }
        }
        this.clock.start(this.score, this.walkEnd.measureIndex, this.walkEnd.beat)
    }

    tick(): boolean {
        if (!this.score || this._done) return true
        const horizon = this.midiPlayer.currentTime + Ticker.LOOK_AHEAD
        while (this.walkTime <= horizon) {
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
        const startTime = this.clock.timeAt(this.measureIdx, beat)
        const endTime = this.clock.timeAt(this.measureIdx, beat + beatSpan)

        // A tie continuation is not re-struck: the chain's first note holds through it
        // (Score.tiedBeats counts only real partners, so a dangling tie mark doesn't extend it).
        if (note.pitch && !note.tiesBack) {
            this.midiPlayer.schedule({
                startTime,
                duration: this.clock.timeAt(this.measureIdx, beat + score.tiedBeats(note)) - startTime,
                // Note pitch is the written pitch (MusicXML semantics); the instrument sounds it transposed.
                midi: score.instrument.soundingMidi(note.pitch),
                instrument: score.instrument,
            })
        }

        this.entries.push({ startTime, duration: endTime - startTime, beatSpan, measureIndex: this.measureIdx, beat })

        this.walkEnd = { measureIndex: this.measureIdx, beat: beat + beatSpan }
        this.noteIdx++
        return true
    }
}
