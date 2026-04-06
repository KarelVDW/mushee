import type { Score } from '@/model/Score'

import { MidiPlayer } from './MidiPlayer'
import type { Tickable } from './Ticker'

const DEFAULT_BPM = 90
const LOOK_AHEAD = 0.05
const CLICK_MIDI = 96 // C7
const CLICK_DURATION = 0.06

export class Metronome implements Tickable {
    score: Score | null = null

    private midiPlayer: MidiPlayer
    private measureIdx = 0
    private beat = 0
    private nextClickTime = 0
    private bpm = DEFAULT_BPM

    constructor(midiPlayer: MidiPlayer) {
        this.midiPlayer = midiPlayer
    }

    reset() {
        this.measureIdx = 0
        this.beat = 0
        this.nextClickTime = 0
        this.bpm = DEFAULT_BPM

        if (this.score) {
            const firstMeasure = this.score.firstMeasure
            if (firstMeasure) {
                const tempo = firstMeasure.tempoAtBeat(0)
                if (tempo) this.bpm = tempo.bpm
            }
        }
    }

    tick(elapsed: number): boolean {
        if (!this.score) return true

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
