/**
 * The eval app's transport: replay of a clip's expected notes (with optional
 * metronome) and metronome-guided takes, built from the same classes the
 * product's editor uses (@mushee/playback, shared with apps/web).
 *
 * A take runs: [count-in clicks] → [clip-length clicks] → small tail → stop.
 * The caller passes a click score that ALREADY contains the count-in measures
 * (rests), so the metronome just walks it; the count-in duration plus the
 * capture-to-clock offset comes back as `trimSec`, which the server cuts off
 * so the saved wav starts at beat 0.
 */

import { Instrument } from '@mushee/notation/model/Instrument'
import type { Score } from '@mushee/notation/model/Score'
import { Metronome } from '@mushee/playback/Metronome'
import { MidiPlayer } from '@mushee/playback/MidiPlayer'
import { ScoreScheduler } from '@mushee/playback/ScoreScheduler'
import type { Tickable } from '@mushee/playback/Ticker'
import { Ticker } from '@mushee/playback/Ticker'

import { TakeRecorder } from './TakeRecorder'

export type EvalPlayerMode = 'idle' | 'playing' | 'recording'

export interface FinishedRecording {
    blob: Blob
    mimeType: string
    /** Seconds to cut from the take's head so t=0 is the clip's beat 0. */
    trimSec: number
}

/** Ends a pass at a fixed clock time — the take's full length plus tail. */
class Stopper implements Tickable {
    constructor(
        private readonly midiPlayer: MidiPlayer,
        private readonly endSec: number,
    ) {}

    reset(): void {}

    tick(): boolean {
        return this.midiPlayer.currentTime >= this.endSec
    }
}

const TAKE_TAIL_SEC = 0.8

export class EvalPlayer {
    readonly midiPlayer = new MidiPlayer()
    private readonly ticker = new Ticker()
    private readonly scheduler = new ScoreScheduler(this.midiPlayer)
    private readonly metronome = new Metronome(this.midiPlayer)
    private readonly recorder = new TakeRecorder()

    private _mode: EvalPlayerMode = 'idle'
    onModeChange?: (mode: EvalPlayerMode) => void

    get mode(): EvalPlayerMode {
        return this._mode
    }

    /** Pre-fetch samples so replay/click start without a download hiccup. */
    async prepare(instrument: Instrument): Promise<void> {
        await this.midiPlayer.loadInstruments([instrument, Instrument.Woodblock])
    }

    playScore(score: Score, options: { metronome: boolean; onFinish?: () => void }): void {
        this.stop()
        this.scheduler.score = score
        this.scheduler.startNote = null
        this.metronome.score = score
        this.metronome.startMeasureIndex = 0
        this.metronome.startBeat = 0

        const tickables: Tickable[] = [this.scheduler]
        if (options.metronome) tickables.push(this.metronome)

        this.midiPlayer.start()
        this.setMode('playing')
        this.ticker.play(tickables, () => {
            this.setMode('idle')
            options.onFinish?.()
        })
    }

    /**
     * Record a take against `clickScore` (count-in measures included). The mic
     * may be refused — the returned promise rejects before anything starts.
     * The take auto-stops after `totalSec` on the playback clock; stop() before
     * that cancels the take (nothing is delivered).
     */
    async record(
        clickScore: Score,
        options: { countInSec: number; totalSec: number; onFinish: (take: FinishedRecording) => void },
    ): Promise<void> {
        this.stop()
        await this.recorder.start()

        this.metronome.score = clickScore
        this.metronome.startMeasureIndex = 0
        this.metronome.startBeat = 0

        this.midiPlayer.start()
        const clockStartMs = performance.now()
        this.setMode('recording')
        this.ticker.play([this.metronome, new Stopper(this.midiPlayer, options.totalSec + TAKE_TAIL_SEC)], () => {
            this.midiPlayer.stop()
            this.setMode('idle')
            void this.recorder.stop().then((take) => {
                const captureLeadSec = (clockStartMs - take.captureStartMs) / 1000
                options.onFinish({
                    blob: take.blob,
                    mimeType: take.mimeType,
                    trimSec: Math.max(0, captureLeadSec + options.countInSec),
                })
            })
        })
    }

    /** Stop whatever runs; a take in flight is CANCELLED, not delivered. */
    stop(): void {
        this.ticker.stop()
        this.recorder.cancel()
        this.midiPlayer.stop()
        this.setMode('idle')
    }

    dispose(): void {
        this.stop()
        this.midiPlayer.dispose()
    }

    private setMode(mode: EvalPlayerMode): void {
        if (this._mode === mode) return
        this._mode = mode
        this.onModeChange?.(mode)
    }
}
