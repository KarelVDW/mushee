/**
 * A/B playback of two recordings of the same clip on one shared playhead — the original and its
 * synthetic copy, or two conditions of one render. Both elements play together and only the
 * selected one is audible, so switching sides is instant and keeps the position: what changes
 * is the sound, never the moment. The selected side is the clock. While playing, the muted side
 * is kept on it by nudging its playback rate (a seek would stall it for a few hundred ms and leave
 * it behind again), so a switch rarely has to seek; a switch that finds the sides apart re-aligns
 * the newly selected one, as every seek does.
 *
 * Measured 2026-10-30 (Playwright, a WAV original against a 24 kHz FLAC copy): Chromium starts the
 * two elements up to ~0.2–0.5 s apart and the nudge closes that in about two seconds; WebKit starts
 * them within ~25 ms but stalls BOTH elements on any rate change, so it gets no nudge.
 */

export type Side = 'a' | 'b'

export interface ABPlayerState {
    playing: boolean
    side: Side
    /** Seconds; the longer of the two once both have loaded their metadata. */
    duration: number
    /** The selected side could not load. */
    error: string | null
}

/** Drift beyond this between the two sides is corrected on a switch (an audible jump is smaller than a wrong moment). */
const MAX_DRIFT_SEC = 0.04
/** How often the muted side is checked against the selected one while playing. */
const SYNC_INTERVAL_MS = 200
/**
 * Drift past `NUDGE_SEC` sets the muted side to ±NUDGE_RATE until it is back inside `SETTLED_SEC`
 * (~0.5 s of drift closes in 2 s; muted, its speed is never heard). The rate changes at most twice
 * per correction: WebKit stalls a playing element on every rate change, so a continuously adjusted
 * rate would never converge there.
 */
const NUDGE_SEC = 0.06
const NUDGE_RATE = 0.25
const SETTLED_SEC = 0.015
/** Beyond this the muted side seeks instead. */
const RESEEK_SEC = 1

export class ABPlayer {
    private readonly els: Record<Side, HTMLAudioElement | null>
    private readonly listeners = new Set<() => void>()
    private side: Side = 'a'
    private snapshot: ABPlayerState
    private syncTimer: ReturnType<typeof setInterval> | null = null
    private readonly nudges = ABPlayer.rateNudgeIsSafe()

    constructor(srcA: string, srcB: string | null) {
        this.els = { a: ABPlayer.element(srcA), b: srcB ? ABPlayer.element(srcB) : null }
        this.snapshot = { playing: false, side: 'a', duration: 0, error: null }
        for (const side of ['a', 'b'] as const) {
            const el = this.els[side]
            if (!el) continue
            el.addEventListener('loadedmetadata', this.update)
            el.addEventListener('durationchange', this.update)
            el.addEventListener('play', this.update)
            el.addEventListener('pause', this.update)
            el.addEventListener('ended', () => this.onEnded(side))
            el.addEventListener('error', this.update)
        }
        this.apply()
    }

    get state(): ABPlayerState {
        return this.snapshot
    }

    get hasB(): boolean {
        return this.els.b !== null
    }

    /** The shared playhead, in seconds. */
    get currentTime(): number {
        return this.active?.currentTime ?? 0
    }

    subscribe = (listener: () => void): (() => void) => {
        this.listeners.add(listener)
        return () => this.listeners.delete(listener)
    }

    getSnapshot = (): ABPlayerState => this.snapshot

    async play(): Promise<void> {
        const active = this.active
        if (!active) return
        if (active.ended || active.currentTime >= (active.duration || Infinity) - 0.01) this.seek(0)
        this.align()
        // Both start inside the same user gesture (autoplay policies), the hidden side muted.
        await Promise.allSettled(this.both().map((el) => el.play()))
        this.startSync()
        this.update()
    }

    pause(): void {
        this.stopSync()
        for (const el of this.both()) el.pause()
        this.update()
    }

    toggle(): void {
        if (this.snapshot.playing) this.pause()
        else void this.play()
    }

    seek(sec: number): void {
        const t = Math.max(0, Math.min(sec, this.snapshot.duration || sec))
        for (const el of this.both()) el.currentTime = Math.min(t, el.duration || t)
        this.update()
    }

    select(side: Side): void {
        if (side === this.side || !this.els[side]) return
        const from = this.active
        this.side = side
        const to = this.active
        if (from && to && Math.abs(to.currentTime - from.currentTime) > MAX_DRIFT_SEC) to.currentTime = from.currentTime
        // The side now heard plays at the true rate; the one now muted is nudged from here on.
        if (to) to.playbackRate = 1
        this.apply()
        this.update()
    }

    dispose(): void {
        this.stopSync()
        for (const el of this.both()) {
            el.pause()
            el.removeAttribute('src')
            el.load()
        }
        this.listeners.clear()
    }

    private get active(): HTMLAudioElement | null {
        return this.els[this.side]
    }

    private both(): HTMLAudioElement[] {
        return [this.els.a, this.els.b].filter((el): el is HTMLAudioElement => el !== null)
    }

    /** Only the selected side is heard. */
    private apply(): void {
        for (const side of ['a', 'b'] as const) {
            const el = this.els[side]
            if (el) el.muted = side !== this.side
        }
    }

    /** The hidden side follows the selected one. */
    private align(): void {
        const active = this.active
        for (const el of this.both()) {
            if (el !== active && active && Math.abs(el.currentTime - active.currentTime) > MAX_DRIFT_SEC)
                el.currentTime = active.currentTime
        }
    }

    private startSync(): void {
        if (this.nudges) this.syncTimer ??= setInterval(this.sync, SYNC_INTERVAL_MS)
    }

    private stopSync(): void {
        if (this.syncTimer !== null) clearInterval(this.syncTimer)
        this.syncTimer = null
        for (const el of this.both()) el.playbackRate = 1
    }

    /** One step of keeping the muted side on the selected one's clock. */
    private sync = (): void => {
        const active = this.active
        if (!active || active.paused || active.seeking) return
        for (const el of this.both()) {
            if (el === active || el.paused || el.ended || el.seeking) continue
            const drift = el.currentTime - active.currentTime
            let rate = el.playbackRate
            if (Math.abs(drift) > RESEEK_SEC && active.currentTime < (el.duration || Infinity)) {
                el.playbackRate = 1
                el.currentTime = active.currentTime
                continue
            }
            if (Math.abs(drift) > NUDGE_SEC) rate = drift > 0 ? 1 - NUDGE_RATE : 1 + NUDGE_RATE
            else if (Math.abs(drift) < SETTLED_SEC || rate > 1 === drift > 0) rate = 1 // settled, or overshot
            if (rate !== el.playbackRate) el.playbackRate = rate
        }
    }

    private onEnded(side: Side): void {
        // The selected side ending ends playback; the hidden side running out early does not.
        if (side === this.side) this.pause()
        this.update()
    }

    private update = (): void => {
        const active = this.active
        const durations = this.both()
            .map((el) => el.duration)
            .filter((d) => Number.isFinite(d))
        const next: ABPlayerState = {
            playing: !!active && !active.paused && !active.ended,
            side: this.side,
            duration: durations.length ? Math.max(...durations) : 0,
            error: active?.error ? `Couldn't load this recording (code ${active.error.code}).` : null,
        }
        const s = this.snapshot
        if (next.playing === s.playing && next.duration === s.duration && next.error === s.error && next.side === s.side) return
        this.snapshot = next
        for (const listener of this.listeners) listener()
    }

    /** WebKit (Safari, and every iOS browser) stalls playing media on a rate change; the others glide. */
    private static rateNudgeIsSafe(): boolean {
        const ua = typeof navigator === 'undefined' ? '' : navigator.userAgent
        return !/AppleWebKit/.test(ua) || /(Chrome|Chromium|Edg)\//.test(ua)
    }

    private static element(src: string): HTMLAudioElement {
        const el = new Audio()
        el.preload = 'auto'
        // A nudged rate is only ever applied while muted, and every audible play runs at 1: plain
        // resampling is enough.
        el.preservesPitch = false
        el.src = src
        return el
    }
}
