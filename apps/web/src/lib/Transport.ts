import type { Note } from '@mushee/notation/model/Note'
import type { Score } from '@mushee/notation/model/Score'

import { CursorManager } from './CursorManager'
import { Metronome } from './Metronome'
import { MidiPlayer } from './MidiPlayer'
import { RecordingEngine, type RecordingOptions } from './RecordingEngine'
import { ScoreScheduler } from './ScoreScheduler'
import type { Tickable } from './Ticker'
import { Ticker } from './Ticker'

export type TransportMode = 'stopped' | 'playing' | 'paused' | 'recording'

export interface PlayScoreOptions {
    score: Score
    /** Note to start from; null = top of the score. */
    startNote: Note | null
    cursorEl: SVGRectElement
    resolvePosition: (pos: { measureIndex: number; beat: number }) => { x: number; rowY: number } | null
    /** Fired when the pass plays through to the end (not on stop()). */
    onFinish?: () => void
}

/**
 * The editor's one transport: owns the shared clock (MidiPlayer time + Ticker
 * rAF loop) and the three units that run against it — score playback
 * (scheduler + cursor), the metronome, and the recording engine.
 *
 * Each mode assembles exactly the tickables it consists of:
 *
 * - `playScore`: scheduler + cursor (+ metronome when enabled)
 * - `record`:    recording engine + metronome (a take always has its click)
 *
 * Nothing persists in the ticker between passes, so a unit can never tick in
 * a mode it doesn't belong to — starting a recording cannot replay the
 * score's existing notes, and playback can never touch the mic.
 */
export class Transport {
    readonly midiPlayer: MidiPlayer
    private readonly ticker = new Ticker()
    private readonly scheduler: ScoreScheduler
    private readonly metronome: Metronome
    private readonly cursor: CursorManager
    private readonly recorder: RecordingEngine

    private _mode: TransportMode = 'stopped'
    private _metronomeEnabled = false

    constructor(midiPlayer: MidiPlayer = new MidiPlayer()) {
        this.midiPlayer = midiPlayer
        this.scheduler = new ScoreScheduler(midiPlayer)
        this.metronome = new Metronome(midiPlayer)
        this.cursor = new CursorManager(midiPlayer, this.scheduler)
        this.recorder = new RecordingEngine(midiPlayer)
    }

    get mode(): TransportMode {
        return this._mode
    }

    get metronomeEnabled(): boolean {
        return this._metronomeEnabled
    }

    get isRecording(): boolean {
        return this.recorder.state !== 'idle'
    }

    /** The mic settings the browser actually granted for the live take (`null` when idle). */
    get micSettings(): MediaTrackSettings | null {
        return this.recorder.micSettings
    }

    /** Play the score from `startNote` (or the top). Stops whatever ran before. */
    playScore(options: PlayScoreOptions): void {
        this.stop()
        const { score, startNote } = options

        this.scheduler.score = score
        this.scheduler.startNote = startNote
        this.metronome.score = score
        this.metronome.startMeasureIndex = startNote?.measure.index ?? 0
        this.metronome.startBeat = startNote ? startNote.measure.beatOffsetOf(startNote) : 0
        this.cursor.bind(options.cursorEl, options.resolvePosition)

        const tickables: Tickable[] = [this.scheduler, this.cursor]
        if (this._metronomeEnabled) tickables.push(this.metronome)

        this.midiPlayer.start()
        this._mode = 'playing'
        this.ticker.play(tickables, () => {
            this._mode = 'stopped'
            options.onFinish?.()
        })
    }

    /** Freeze the clock mid-playback; `resume` picks up where it left off. */
    pause(): void {
        if (this._mode !== 'playing') return
        this.ticker.stop()
        this.midiPlayer.pause()
        this._mode = 'paused'
    }

    resume(): void {
        if (this._mode !== 'paused') return
        this.midiPlayer.resume()
        this.ticker.resume()
        this._mode = 'playing'
    }

    /**
     * Begin a recording session: acquire the mic (may reject — permission,
     * unsupported browser), then run the recording engine with the count-off
     * metronome. The metronome always clicks during a take, whatever its
     * playback toggle says. Rethrows engine start failures after cleaning up.
     */
    async record(options: RecordingOptions): Promise<void> {
        this.stop()
        try {
            await this.recorder.start(options)
        } catch (err) {
            this.stop()
            throw err
        }
        // stop() may have run while the mic permission prompt was open; the
        // engine already released the stream, so don't start a zombie pass.
        if (this.recorder.state === 'idle') return

        this.metronome.score = options.score
        this.metronome.startMeasureIndex = options.startMeasureIndex
        this.metronome.startBeat = 0

        this.midiPlayer.start()
        this._mode = 'recording'
        this.ticker.play([this.recorder, this.metronome], () => {
            this._mode = 'stopped'
        })
    }

    /** Stop everything: clock, playback pass, recording session, cursor. Idempotent. */
    stop(): void {
        this.ticker.stop()
        this.recorder.stop()
        this.midiPlayer.stop()
        this.cursor.hideCursor()
        this._mode = 'stopped'
    }

    /**
     * Toggle the metronome for playback. Takes effect immediately when a pass
     * is in flight. Recording is unaffected — a take always keeps its click.
     */
    setMetronomeEnabled(enabled: boolean): void {
        if (this._metronomeEnabled === enabled) return
        this._metronomeEnabled = enabled
        if (this._mode !== 'playing' && this._mode !== 'paused') return
        if (enabled) {
            // Joining mid-pass: skip the clicks that already elapsed.
            this.metronome.reset()
            this.metronome.syncTo(this.midiPlayer.currentTime)
            this.ticker.addTickable(this.metronome)
        } else {
            this.ticker.removeTickable(this.metronome)
        }
    }

    dispose(): void {
        this.stop()
        this.midiPlayer.dispose()
    }
}
