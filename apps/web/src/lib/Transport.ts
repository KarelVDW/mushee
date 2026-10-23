import type { Instrument, Note, Score } from '@mushee/notation/model'
import { Metronome } from '@mushee/playback/Metronome'
import { MidiPlayer } from '@mushee/playback/MidiPlayer'
import { ScoreScheduler } from '@mushee/playback/ScoreScheduler'
import type { Tickable } from '@mushee/playback/Ticker'
import { Ticker } from '@mushee/playback/Ticker'

import { PlaybackCursor } from './PlaybackCursor'
import { RecordingEngine, type RecordingOptions } from './RecordingEngine'

export type TransportMode = 'stopped' | 'playing' | 'paused' | 'recording'

/** The transport as the play button sees it: a recording take reads as 'stopped' — recording has its own control. */
export type PlaybackState = Exclude<TransportMode, 'recording'>

/** How long a selected note's preview sounds, in seconds. */
const PREVIEW_SECONDS = 0.75

export interface PlayScoreOptions {
    score: Score
    /** Note to start from; null = top of the score. */
    startNote: Note | null
    /** The score's playhead (cursor group); the pass's PlaybackCursor draws into it. */
    cursorEl: SVGGElement
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
    private readonly midiPlayer: MidiPlayer
    private readonly ticker = new Ticker()
    private readonly scheduler: ScoreScheduler
    private readonly metronome: Metronome
    private readonly cursor: PlaybackCursor
    private readonly recorder: RecordingEngine

    private _mode: TransportMode = 'stopped'
    private _metronomeEnabled = false

    /**
     * Fired on every mode write — play, pause, resume, record, stop, and a pass
     * or take running out on its own — so a view can mirror {@link mode}
     * instead of keeping a copy that could drift from it.
     */
    onModeChange?: (mode: TransportMode) => void

    constructor(midiPlayer: MidiPlayer = new MidiPlayer()) {
        this.midiPlayer = midiPlayer
        this.scheduler = new ScoreScheduler(midiPlayer)
        this.metronome = new Metronome(midiPlayer)
        this.cursor = new PlaybackCursor(midiPlayer, this.scheduler)
        this.recorder = new RecordingEngine(midiPlayer, this.cursor)
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

    /**
     * Pre-fetch the samples a pass needs: `instrument`'s, plus the metronome
     * click's unless `metronome` is false (a page that never clicks). Scheduling
     * a note whose samples are still downloading is a silent skip, so callers
     * gate playback on this.
     */
    async prepare(instrument: Instrument, { metronome = true }: { metronome?: boolean } = {}): Promise<void> {
        await this.midiPlayer.loadInstruments(metronome ? [instrument, Metronome.INSTRUMENT] : [instrument])
    }

    /** Sound `note` of `score` briefly — at the pitch the score's instrument sounds it — cutting off any earlier preview. */
    preview(score: Score, note: Note): void {
        if (!note.pitch) return
        this.midiPlayer.preview(score.instrument.soundingMidi(note.pitch), PREVIEW_SECONDS, score.instrument)
    }

    /** Play the score from `startNote` (or the top). Stops whatever ran before. */
    playScore(options: PlayScoreOptions): void {
        this.stop()
        const { score, startNote } = options

        this.scheduler.cue(score, startNote)
        // The clicks follow the scheduler's clock, so they keep to the notes even when the score is edited mid-pass.
        this.metronome.cue(
            score,
            startNote?.measure.index ?? 0,
            startNote ? startNote.measure.beatOffsetOf(startNote) : 0,
            this.scheduler.clock,
        )
        this.cursor.attach(options.cursorEl)
        this.cursor.follow(score)

        const tickables: Tickable[] = [this.scheduler, this.cursor]
        if (this._metronomeEnabled) tickables.push(this.metronome)

        this.midiPlayer.start()
        this.setMode('playing')
        this.ticker.play(tickables, () => this.setMode('stopped'))
    }

    /** Freeze the clock mid-playback; `resume` picks up where it left off. */
    pause(): void {
        if (this._mode !== 'playing') return
        this.ticker.stop()
        this.midiPlayer.pause()
        this.setMode('paused')
    }

    resume(): void {
        if (this._mode !== 'paused') return
        this.midiPlayer.resume()
        this.ticker.resume()
        this.setMode('playing')
    }

    /**
     * Begin a recording session: acquire the mic (may reject — permission,
     * unsupported browser), then run the recording engine with the count-off
     * metronome. The metronome always clicks during a take, whatever its
     * playback toggle says. Rethrows engine start failures after cleaning up.
     * Resolves to the mic settings granted for the take (see
     * {@link RecordingEngine.start}), or null when no take started.
     */
    async record(options: RecordingOptions): Promise<MediaTrackSettings | null> {
        this.stop()
        this.cursor.attach(options.cursorEl)
        let mic: MediaTrackSettings | null
        try {
            mic = await this.recorder.start(options)
        } catch (err) {
            this.stop()
            throw err
        }
        // stop() may have run while the mic permission prompt was open; the
        // engine already released the stream, so don't start a zombie pass.
        if (this.recorder.state === 'idle') return null

        this.metronome.cue(options.score, options.startMeasureIndex)

        this.midiPlayer.start()
        this.setMode('recording')
        this.ticker.play([this.recorder, this.metronome], () => this.setMode('stopped'))
        return mic
    }

    /** Stop everything: clock, playback pass, recording session, cursor. Idempotent. */
    stop(): void {
        this.ticker.stop()
        this.recorder.stop()
        this.midiPlayer.stop()
        this.cursor.hide()
        this.setMode('stopped')
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
            this.metronome.joinAt(this.midiPlayer.currentTime)
            this.ticker.addTickable(this.metronome)
        } else {
            this.ticker.removeTickable(this.metronome)
        }
    }

    dispose(): void {
        this.stop()
        this.midiPlayer.dispose()
    }

    private setMode(mode: TransportMode): void {
        this._mode = mode
        this.onModeChange?.(mode)
    }
}
