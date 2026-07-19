import { Soundfont, type StopFn } from 'smplr'

import { Instrument } from '@/model/Instrument'

export interface ScheduledNote {
    startTime: number
    duration: number
    midi: number
    instrument: Instrument
}

type NavigatorWithAudioSession = Navigator & { audioSession?: { type: string } }

/**
 * Plays MIDI notes via smplr's Soundfont sampler. Has no knowledge of scores
 * or music notation. Each Instrument is loaded lazily on first request and
 * kept in memory for the lifetime of this player. Call `loadInstruments`
 * before `start`/`schedule` to avoid silent skips while samples download.
 */
export class MidiPlayer {
    private audioCtx: AudioContext | null = null
    private soundfonts = new Map<string, { sf: Soundfont; ready: Promise<unknown> }>()
    private startOffset = 0
    private scheduledStops: StopFn[] = []
    private previewStops: StopFn[] = []

    get currentTime(): number {
        if (!this.audioCtx) return 0
        return this.audioCtx.currentTime - this.startOffset
    }

    get isActive(): boolean {
        return this.audioCtx !== null
    }

    /**
     * Pre-fetch the listed instruments. Resolves once every requested
     * instrument's samples are loaded. Subsequent calls for the same
     * instrument are deduped.
     */
    async loadInstruments(instruments: Iterable<Instrument>): Promise<void> {
        const ctx = this.ensureCtx()
        const promises: Promise<unknown>[] = []
        for (const instrument of instruments) {
            const existing = this.soundfonts.get(instrument.id)
            if (existing) {
                promises.push(existing.ready)
                continue
            }
            const sf = new Soundfont(ctx, { instrument: instrument.presetName, kit: 'FluidR3_GM' })
            const ready = sf.loaded()
            this.soundfonts.set(instrument.id, { sf, ready })
            promises.push(ready)
        }
        await Promise.all(promises)
    }

    /** Begin a playback session. Notes are scheduled individually via `schedule`. */
    start() {
        this.stop()
        MidiPlayer.setAudioSessionType('playback')
        const ctx = this.ensureCtx()
        if (ctx.state === 'suspended') ctx.resume().catch(() => {})
        this.startOffset = ctx.currentTime
    }

    /** Schedule a single note on the running playback context. */
    schedule(note: ScheduledNote) {
        if (!this.audioCtx) return
        const sf = this.soundfonts.get(note.instrument.id)?.sf
        if (!sf) return
        const stop = sf.start({
            note: note.midi,
            time: this.startOffset + note.startTime,
            duration: note.duration,
        })
        this.scheduledStops.push(stop)
    }

    stop() {
        this.cancelStops(this.scheduledStops)
        this.scheduledStops = []
        MidiPlayer.setAudioSessionType('auto')
    }

    /** Suspend playback — freezes currentTime and halts audio output without losing state. */
    pause() {
        this.audioCtx?.suspend().catch(() => {})
    }

    /** Resume a suspended playback context. */
    resume() {
        MidiPlayer.setAudioSessionType('playback')
        this.audioCtx?.resume().catch(() => {})
    }

    /** Play a single note for the given duration. Stops any previous preview. */
    preview(midi: number, duration: number, instrument: Instrument) {
        this.stopPreview()
        MidiPlayer.setAudioSessionType('playback')
        const ctx = this.ensureCtx()
        if (ctx.state === 'suspended') ctx.resume().catch(() => {})
        const sf = this.soundfonts.get(instrument.id)?.sf
        if (!sf) return
        const stop = sf.start({ note: midi, time: ctx.currentTime, duration })
        this.previewStops.push(stop)
    }

    stopPreview() {
        this.cancelStops(this.previewStops)
        this.previewStops = []
    }

    /** Releases all loaded samples and closes the audio context. */
    dispose() {
        this.stop()
        this.stopPreview()
        for (const { sf } of this.soundfonts.values()) sf.disconnect()
        this.soundfonts.clear()
        this.audioCtx?.close().catch(() => {})
        this.audioCtx = null
        MidiPlayer.setAudioSessionType('auto')
    }

    // --- Internal ---

    private ensureCtx(): AudioContext {
        if (!this.audioCtx) this.audioCtx = new AudioContext()
        return this.audioCtx
    }

    /**
     * Hint the OS audio session via WebKit's API; no-op on other browsers.
     * iOS mutes Web Audio while the hardware silent switch is on unless the
     * session is declared 'playback' — without this, replay is inaudible for
     * anyone whose phone is on silent. Never touches a 'play-and-record'
     * session: during a take the RecordingEngine owns it, and reclaiming it
     * for playback-only would break mic capture under the count-off.
     */
    private static setAudioSessionType(type: 'playback' | 'auto'): void {
        if (typeof navigator === 'undefined') return
        const session = (navigator as NavigatorWithAudioSession).audioSession
        if (!session || session.type === 'play-and-record') return
        session.type = type
    }

    private cancelStops(stops: StopFn[]) {
        for (const stop of stops) {
            try {
                stop()
            } catch {
                /* already stopped */
            }
        }
    }
}
