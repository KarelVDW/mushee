import { Instrument } from '@mushee/notation/model/Instrument'
import type { Score } from '@mushee/notation/model/Score'

import { MidiPlayer } from './MidiPlayer'
import type { Tickable } from './Ticker'

const DEFAULT_BPM = 90
const LOOK_AHEAD = 0.05
/** Regular click, and the higher-pitched one that marks the downbeat of every measure. */
const CLICK_MIDI = 96 // C7
const ACCENT_MIDI = 108 // C8, an octave up
const CLICK_DURATION = 0.06
/** Tolerance for beat arithmetic — dotted pulses (1.5) and eighths (0.5) sum exactly, but stay safe. */
const EPSILON = 1e-6

/**
 * Clicks once per felt beat — the meter's pulse (`TimeSignature.pulse`): every
 * quarter in 4/4, every dotted quarter in 6/8 (two clicks a bar), every half in
 * 2/2 — with the first click of each measure accented. Beat positions and `bpm`
 * are in quarter-note units like the rest of the model; the pulse only decides
 * where the clicks fall.
 */
export class Metronome implements Tickable {
    score: Score | null = null
    /** Measure index to begin ticking from. Default 0 = start of score. */
    startMeasureIndex = 0
    /** Beat (quarter units) within the start measure to begin ticking from. Default 0 = downbeat. */
    startBeat = 0

    private midiPlayer: MidiPlayer
    private measureIdx = 0
    private beat = 0
    private nextClickTime = 0
    private bpm = DEFAULT_BPM

    constructor(midiPlayer: MidiPlayer) {
        this.midiPlayer = midiPlayer
    }

    reset() {
        this.measureIdx = this.startMeasureIndex
        this.beat = this.startBeat
        this.nextClickTime = 0
        this.bpm = DEFAULT_BPM

        if (!this.score) return

        // Walk back from the start measure to find the last active tempo.
        for (let i = this.startMeasureIndex; i >= 0; i--) {
            const measure = this.score.measures[i]
            if (!measure) continue
            const tempos = [...measure.tempos].sort((a, b) => b.beatPosition - a.beatPosition)
            if (tempos.length > 0) {
                this.bpm = tempos[0].bpm
                break
            }
        }
    }

    /**
     * Fast-forward past clicks up to `elapsed` without scheduling them. Used
     * when the metronome joins a pass already in flight (toggled on
     * mid-playback) — without this, tick() would burst-schedule every click
     * since the pass began.
     */
    syncTo(elapsed: number): void {
        if (!this.score) return
        while (this.nextClickTime <= elapsed) {
            if (!this.step(false)) return
        }
    }

    tick(): boolean {
        if (!this.score) return true
        const horizon = this.midiPlayer.currentTime + LOOK_AHEAD
        while (this.nextClickTime <= horizon) {
            if (!this.step(true)) return true
        }
        return false
    }

    /**
     * Advance the walk by one pulse: schedule the click due at `nextClickTime`
     * (when `schedule`) and move on. Returns false once the score is exhausted.
     */
    private step(schedule: boolean): boolean {
        const measure = this.score?.measures[this.measureIdx]
        if (!measure) return false

        if (this.beat >= measure.maxBeats - EPSILON) {
            this.measureIdx++
            this.beat = 0
            return true
        }

        const tempo = measure.tempoAtBeat(this.beat)
        if (tempo) this.bpm = tempo.bpm

        const pulse = measure.timeSignature.pulse.beats
        const secondsPerBeat = 60 / this.bpm
        // Playback from a note off the pulse grid (e.g. the second eighth of a 6/8
        // group): wait for the next pulse so the clicks land where they belong.
        const boundary = Math.ceil(this.beat / pulse - EPSILON) * pulse
        if (boundary > this.beat + EPSILON) {
            this.nextClickTime += (boundary - this.beat) * secondsPerBeat
            this.beat = boundary
            return true
        }

        if (schedule) {
            this.midiPlayer.schedule({
                startTime: this.nextClickTime,
                duration: CLICK_DURATION,
                midi: this.beat < EPSILON ? ACCENT_MIDI : CLICK_MIDI,
                instrument: Instrument.Woodblock,
            })
        }

        this.beat += pulse
        this.nextClickTime += pulse * secondsPerBeat
        return true
    }
}
