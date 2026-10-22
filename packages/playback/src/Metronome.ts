import { Instrument } from '@mushee/notation/model/Instrument'
import type { Score } from '@mushee/notation/model/Score'

import type { MidiPlayer } from './MidiPlayer'
import { type Tickable, Ticker } from './Ticker'

/** Regular click, and the higher-pitched one that marks the downbeat of every measure. */
const CLICK_MIDI = 96 // C7
const ACCENT_MIDI = 108 // C8, an octave up
const CLICK_DURATION = 0.06
/** Tolerance for beat arithmetic — dotted pulses (1.5) and eighths (0.5) sum exactly, but stay safe. */
const EPSILON = 1e-6

/**
 * Clicks once per felt beat — the meter's pulse (`TimeSignature.pulse`): every
 * quarter in 4/4, every dotted quarter in 6/8 (two clicks a bar), every half in
 * 2/2 — with the first click of each measure accented. Beat positions are in
 * quarter-note units like the rest of the model; the pulse only decides where
 * the clicks fall. Each click's time comes from the score's one clock
 * (`Score.secondsAt`), measured from the start position, so clicks land on the
 * notes ScoreScheduler plays whatever tempo markings sit between them.
 */
export class Metronome implements Tickable {
    /** The click's sound; load it alongside a score's instrument before a pass that clicks. */
    static readonly INSTRUMENT = Instrument.Woodblock

    private score: Score | null = null
    private startMeasureIndex = 0
    private startBeat = 0

    private midiPlayer: Pick<MidiPlayer, 'currentTime' | 'schedule'>
    private measureIdx = 0
    private beat = 0
    /** Score time (`Score.secondsAt`) of the start position; the pass clock reads 0 there. */
    private origin = 0

    constructor(midiPlayer: Pick<MidiPlayer, 'currentTime' | 'schedule'>) {
        this.midiPlayer = midiPlayer
    }

    /**
     * Set up the next pass: click through `score` from `startBeat` (quarter
     * units) of measure `startMeasureIndex` — by default the top of the score.
     * The pass begins on the next reset() (Ticker.play) or joinAt().
     */
    cue(score: Score, startMeasureIndex = 0, startBeat = 0): void {
        this.score = score
        this.startMeasureIndex = startMeasureIndex
        this.startBeat = startBeat
    }

    reset() {
        this.measureIdx = this.startMeasureIndex
        this.beat = this.startBeat
        const start = this.score?.measures[this.startMeasureIndex]
        this.origin = start && this.score ? this.score.secondsAt(start, this.startBeat) : 0
    }

    /**
     * Restart the cued pass and fast-forward past the clicks up to `elapsed`
     * without scheduling them. Used when the metronome joins a pass already in
     * flight (toggled on mid-playback) — without this, tick() would
     * burst-schedule every click since the pass began.
     */
    joinAt(elapsed: number): void {
        this.reset()
        for (let click = this.nextClick(); click && click.time <= elapsed; click = this.nextClick()) {
            this.beat = click.beat + click.pulse
        }
    }

    tick(): boolean {
        const horizon = this.midiPlayer.currentTime + Ticker.LOOK_AHEAD
        for (let click = this.nextClick(); click; click = this.nextClick()) {
            if (click.time > horizon) return false
            this.midiPlayer.schedule({
                startTime: click.time,
                duration: CLICK_DURATION,
                midi: click.beat < EPSILON ? ACCENT_MIDI : CLICK_MIDI,
                instrument: Metronome.INSTRUMENT,
            })
            this.beat = click.beat + click.pulse
        }
        return true
    }

    /**
     * The next click at or after the walk position — its beat, pulse length and
     * time on the pass clock — settling the walk onto it (past a measure's end
     * into the next one). Null once the score is exhausted.
     */
    private nextClick(): { beat: number; pulse: number; time: number } | null {
        const score = this.score
        if (!score) return null
        for (let measure = score.measures[this.measureIdx]; measure; measure = score.measures[++this.measureIdx]) {
            const pulse = measure.timeSignature.pulse.beats
            // Playback from a note off the pulse grid (e.g. the second eighth of a 6/8
            // group): wait for the next pulse so the clicks land where they belong.
            const beat = Math.ceil(this.beat / pulse - EPSILON) * pulse
            if (beat < measure.maxBeats - EPSILON) {
                this.beat = beat
                return { beat, pulse, time: score.secondsAt(measure, beat) - this.origin }
            }
            this.beat = 0
        }
        return null
    }
}
