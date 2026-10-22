import type { Score } from '@mushee/notation/model/Score'

import type { MidiPlayer } from './MidiPlayer'

/** A score position — measure index and quarter beat into it — and the pass time the clock gave it. */
interface Reading {
    measureIndex: number
    beat: number
    time: number
}

/**
 * The clock one pass runs on: seconds since the pass began, read off the
 * score's one clock (`Score.secondsAt`) from the pass's start position. A
 * ScoreScheduler owns one, and a Metronome playing along is cued to follow it,
 * so notes and clicks share every tempo marking — and every edit.
 *
 * The score can change mid-pass: a tempo marking or meter edited upstream, or a
 * measure removed before the play position, moves every later position on the
 * score's clock. Measured from the old origin, what is still to come would land
 * in the past (struck all at once, the cursor leaping ahead) or far ahead
 * (silence, the cursor frozen). So the first read after an edit re-anchors the
 * clock on the earliest reading the audio has not reached yet. Each unit reads
 * its next event's position before scheduling it, so every event still to come
 * lies at or after that reading: it keeps its time, nothing moves into the
 * past, and only what follows it moves with the edit.
 *
 * Units re-read their walk position on every tick rather than keep a time from
 * an earlier read, since a re-anchor moves it.
 */
export class PassClock {
    private score: Score | null = null
    /** Score time (`Score.secondsAt`) at which the pass clock reads 0. */
    private origin = 0
    /** The score version `origin` holds for. */
    private version = 0
    /** Readings the audio has not passed yet, one per position, all against `origin`: what a re-anchor holds in place. */
    private ahead: Reading[] = []

    constructor(private readonly midiPlayer: Pick<MidiPlayer, 'currentTime'>) {}

    /** Begin a pass over `score`: the clock reads 0 at `beat` of measure `measureIndex`. */
    start(score: Score, measureIndex: number, beat: number): void {
        this.score = score
        this.version = score.version
        this.origin = this.scoreSecondsAt(score, measureIndex, beat)
        this.ahead = [{ measureIndex, beat, time: 0 }]
    }

    /**
     * Pass time, in seconds, of `beat` (quarter units; a beat past the barline
     * runs on into the next measure) in measure `measureIndex`.
     */
    timeAt(measureIndex: number, beat: number): number {
        const score = this.score
        if (!score) throw new Error('PassClock read before start()')
        if (score.version !== this.version) this.reanchor(score)

        const time = this.scoreSecondsAt(score, measureIndex, beat) - this.origin
        const now = this.midiPlayer.currentTime
        this.ahead = this.ahead.filter((r) => r.time >= now && (r.measureIndex !== measureIndex || r.beat !== beat))
        this.ahead.push({ measureIndex, beat, time })
        return time
    }

    /** Move the origin so the earliest reading still ahead of the audio keeps its time on the edited score. */
    private reanchor(score: Score): void {
        this.version = score.version
        const now = this.midiPlayer.currentTime
        let anchor: Reading | null = null
        for (const reading of this.ahead) {
            // A reading in a measure the edit removed has no position left to hold.
            if (reading.time < now || reading.measureIndex >= score.measures.length) continue
            if (!anchor || reading.time < anchor.time) anchor = reading
        }
        if (!anchor) return
        this.origin = this.scoreSecondsAt(score, anchor.measureIndex, anchor.beat) - anchor.time
        // The other readings were timed against the old origin; only the anchor still holds.
        this.ahead = [anchor]
    }

    /** `Score.secondsAt` by measure index; a position past the last measure (removed mid-pass) reads as the score's end. */
    private scoreSecondsAt(score: Score, measureIndex: number, beat: number): number {
        const measure = score.measures[measureIndex]
        if (measure) return score.secondsAt(measure, beat)
        const last = score.lastMeasure
        return last ? score.secondsAt(last, last.maxBeats) : 0
    }
}
