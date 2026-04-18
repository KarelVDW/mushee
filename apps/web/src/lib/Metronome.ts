import type { Score } from '@/model/Score'

import { MidiPlayer } from './MidiPlayer'
import type { Tickable } from './Ticker'

const DEFAULT_BPM = 90
const LOOK_AHEAD = 0.05
const CLICK_MIDI = 96 // C7
const CLICK_DURATION = 0.06

export class Metronome implements Tickable {
    score: Score | null = null
    /** Measure index to begin ticking from. Default 0 = start of score. */
    startMeasureIndex = 0

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
        this.beat = 0
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

    tick(): boolean {
        if (!this.score) return true
        const elapsed = this.midiPlayer.currentTime
        while (this.nextClickTime <= elapsed + LOOK_AHEAD) {
            const measure = this.score.measures[this.measureIdx]
            if (!measure) return true

            if (this.beat === 0) {
                const tempo = measure.tempoAtBeat(0)
                if (tempo) this.bpm = tempo.bpm
            }

            if (this.beat >= measure.maxBeats) {
                this.measureIdx++
                this.beat = 0
                continue
            }

            this.midiPlayer.schedule({
                startTime: this.nextClickTime,
                duration: CLICK_DURATION,
                midi: CLICK_MIDI,
            })

            this.beat++
            this.nextClickTime += 60 / this.bpm
        }

        return false
    }
}
