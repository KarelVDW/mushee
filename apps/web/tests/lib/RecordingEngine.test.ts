import type { Score } from '@mushee/notation/model/Score'
import { makeScore } from '@mushee/notation/testing'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { MidiPlayer } from '@/lib/MidiPlayer'
import { RecordingEngine, type RecordingOptions, RecordingUnsupportedError } from '@/lib/RecordingEngine'

// Shape of the JSON `meta` frame the engine sends when streaming opens.
interface MetaFrame {
    type: string
    bpm: number
    timeSignature: { beats: number; beatType: number } | null
    mimeType: string | null
}

// --- AudioContext stub (analyser pipeline) ---------------------------------
let lastAnalyser: FakeAnalyser | null = null
const rememberAnalyser = (analyser: FakeAnalyser): void => {
    lastAnalyser = analyser
}
class FakeAnalyser {
    fftSize = 2048
    connect = vi.fn()
    // Filled by the test to control the RMS the engine computes.
    sample = 128
    getByteTimeDomainData = vi.fn((arr: Uint8Array) => {
        for (let i = 0; i < arr.length; i++) arr[i] = this.sample
    })
    constructor() {
        rememberAnalyser(this)
    }
}
class FakeAudioContext {
    createMediaStreamSource = vi.fn(() => ({ connect: vi.fn() }))
    createAnalyser = vi.fn(() => new FakeAnalyser())
    close = vi.fn(() => Promise.resolve())
}

// --- MediaRecorder stub ----------------------------------------------------
let lastRecorder: FakeMediaRecorder | null = null
const rememberRecorder = (recorder: FakeMediaRecorder): void => {
    lastRecorder = recorder
}
class FakeMediaRecorder {
    state: 'inactive' | 'recording' = 'inactive'
    ondataavailable: ((e: { data: { size: number } }) => void) | null = null
    onstop: (() => void) | null = null
    start = vi.fn((_ms?: number) => {
        this.state = 'recording'
    })
    stop = vi.fn(() => {
        this.state = 'inactive'
        // A real MediaRecorder fires onstop after flushing its final chunk;
        // the engine defers the socket close until then.
        this.onstop?.()
    })
    constructor(
        public stream: unknown,
        public options?: { mimeType?: string },
    ) {
        rememberRecorder(this)
    }
}

// --- WebSocket stub --------------------------------------------------------
let lastSocket: FakeWebSocket | null = null
const rememberSocket = (socket: FakeWebSocket): void => {
    lastSocket = socket
}
class FakeWebSocket {
    static OPEN = 1
    static CLOSED = 3
    readyState = FakeWebSocket.OPEN
    sent: unknown[] = []
    private listeners: Record<string, Array<(e: unknown) => void>> = {}
    send = vi.fn((data: unknown) => {
        this.sent.push(data)
    })
    close = vi.fn()
    addEventListener = vi.fn((type: string, cb: (e: unknown) => void) => {
        ;(this.listeners[type] ||= []).push(cb)
    })
    fire(type: string, event: unknown = {}) {
        for (const cb of this.listeners[type] ?? []) cb(event)
    }
    constructor(public url: string) {
        rememberSocket(this)
    }
}

// --- Non-null accessors for the most-recent stub instances -----------------
function socket(): FakeWebSocket {
    if (!lastSocket) throw new Error('expected a websocket to have been created')
    return lastSocket
}
function recorder(): FakeMediaRecorder {
    if (!lastRecorder) throw new Error('expected a media recorder to have been created')
    return lastRecorder
}
function recorderOnData(): (e: { data: { size: number } }) => void {
    const handler = recorder().ondataavailable
    if (!handler) throw new Error('expected an ondataavailable handler to be registered')
    return handler
}
function analyser(): FakeAnalyser {
    if (!lastAnalyser) throw new Error('expected an analyser to have been created')
    return lastAnalyser
}

// --- MediaStream stub ------------------------------------------------------
function fakeStream(settings: MediaTrackSettings = { echoCancellation: false, noiseSuppression: false, autoGainControl: false }) {
    const track = { stop: vi.fn(), getSettings: vi.fn(() => settings) }
    return { getTracks: () => [track], getAudioTracks: () => [track], track }
}

function fakePlayer(currentTime = 0) {
    const raw = { currentTime }
    return { player: raw as unknown as MidiPlayer, raw }
}

function svgRect(): SVGRectElement {
    return document.createElementNS('http://www.w3.org/2000/svg', 'rect')
}

/**
 * Build options for a recording starting at `startMeasureIndex`. The score has
 * `measureCount` 4/4 measures. `resolvePosition` returns a stub layout point.
 */
function makeOptions(over: Partial<RecordingOptions> & { measureCount?: number } = {}) {
    const measureCount = over.measureCount ?? 4
    const score: Score = (over.score as Score) ?? makeScore(measureCount)
    const cursorEl = svgRect()
    const onStateChange = vi.fn()
    const onNeedNewMeasure = vi.fn()
    const onSample = vi.fn()
    const onScoreUpdate = vi.fn()
    const onLimitReached = vi.fn()
    const onRecordingError = vi.fn()
    const resolvePosition = vi.fn(
        (measureIndex: number, beat: number): { x: number; rowY: number } | null => ({ x: measureIndex * 100 + beat * 10, rowY: 0 }),
    )
    const options: RecordingOptions = {
        score,
        startMeasureIndex: over.startMeasureIndex ?? 0,
        cursorEl,
        resolvePosition,
        wsUrl: 'ws://localhost/stream',
        onStateChange,
        onNeedNewMeasure,
        onSample,
        onScoreUpdate,
        onLimitReached,
        onRecordingError,
        ...over,
    }
    return {
        options,
        score,
        cursorEl,
        onStateChange,
        onNeedNewMeasure,
        onSample,
        onScoreUpdate,
        onLimitReached,
        onRecordingError,
        resolvePosition,
    }
}

describe('RecordingEngine', () => {
    let getUserMedia: ReturnType<typeof vi.fn>

    beforeEach(() => {
        lastAnalyser = null
        lastRecorder = null
        lastSocket = null
        getUserMedia = vi.fn(() => Promise.resolve(fakeStream()))
        vi.stubGlobal('navigator', { mediaDevices: { getUserMedia } })
        vi.stubGlobal('AudioContext', FakeAudioContext)
        vi.stubGlobal('MediaRecorder', FakeMediaRecorder)
        vi.stubGlobal('WebSocket', FakeWebSocket)
    })

    afterEach(() => {
        vi.unstubAllGlobals()
        vi.restoreAllMocks()
    })

    it('starts idle and tick() is done while idle', () => {
        const { player } = fakePlayer()
        const engine = new RecordingEngine(player)
        expect(engine.state).toBe('idle')
        expect(engine.tick()).toBe(true)
    })

    it('start() captures mic, enters countoff, paints the cursor and notifies', async () => {
        const { player } = fakePlayer()
        const engine = new RecordingEngine(player)
        const { options, cursorEl, onStateChange } = makeOptions()

        await engine.start(options)

        expect(getUserMedia).toHaveBeenCalledWith({
            audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
        })
        expect(engine.state).toBe('countoff')
        expect(onStateChange).toHaveBeenCalledWith('countoff')
        // Cursor painted red and moved to the count-off measure.
        expect(cursorEl.getAttribute('fill')).toBe('#ef4444')
        expect(cursorEl.getAttribute('display')).toBe('')
        // Analyser configured.
        expect(lastAnalyser?.fftSize).toBe(256)
    })

    it('countoff tick transitions to recording after the countoff window and begins streaming', async () => {
        const { player, raw } = fakePlayer()
        const engine = new RecordingEngine(player)
        const { options, onStateChange } = makeOptions()
        await engine.start(options)

        // Before the countoff end: still counting off, no transition.
        raw.currentTime = 0.5
        expect(engine.tick()).toBe(false)
        expect(engine.state).toBe('countoff')

        // 4 beats at 90bpm => countoff lasts 4*60/90 = 2.667s. Pass it.
        raw.currentTime = 3
        expect(engine.tick()).toBe(false)
        expect(engine.state).toBe('recording')
        expect(onStateChange).toHaveBeenLastCalledWith('recording')

        // beginStreaming opened a socket. Fire 'open' to let the async flow continue.
        expect(lastSocket).not.toBeNull()
        socket().fire('open')
        await Promise.resolve()
        await Promise.resolve()

        // meta frame sent on open, then the media recorder started.
        const meta = JSON.parse(socket().sent[0] as string) as MetaFrame
        expect(meta).toMatchObject({ type: 'meta', bpm: 90 })
        expect(meta.timeSignature).toEqual({ beats: 4, beatType: 4 })
        expect(lastRecorder?.start).toHaveBeenCalledWith(100)
    })

    it('moves the cursor during recording and emits an anchored amplitude sample', async () => {
        const { player, raw } = fakePlayer()
        const engine = new RecordingEngine(player)
        const { options, cursorEl, onSample, resolvePosition } = makeOptions()
        await engine.start(options)

        // Force into recording.
        raw.currentTime = 3
        engine.tick()
        socket().fire('open')
        await Promise.resolve()

        resolvePosition.mockClear()
        onSample.mockClear()
        // Make the analyser produce a non-zero RMS so the sample carries amplitude.
        analyser().sample = 200
        // A little past the countoff end => first recording measure, beat ~0.x.
        raw.currentTime = 2.8
        engine.tick()

        expect(cursorEl.getAttribute('display')).toBe('')
        expect(resolvePosition).toHaveBeenCalled()
        expect(onSample).toHaveBeenCalledTimes(1)
        const sample = onSample.mock.calls[0][0] as { measureIndex: number; beat: number; amp: number; timeMs: number }
        expect(sample.measureIndex).toBe(0)
        expect(sample.amp).toBeGreaterThan(0)
        expect(sample.amp).toBeLessThanOrEqual(1)
        expect(sample.timeMs).toBeGreaterThanOrEqual(0)
    })

    it('records without a sample consumer (onSample undefined)', async () => {
        const { player, raw } = fakePlayer()
        const engine = new RecordingEngine(player)
        const { options, cursorEl } = makeOptions({ onSample: undefined })
        await engine.start(options)
        raw.currentTime = 3
        engine.tick()
        socket().fire('open')
        await Promise.resolve()

        analyser().sample = 200
        raw.currentTime = 2.8
        // sampleAmplitude short-circuits without a consumer; the cursor still moves.
        expect(() => engine.tick()).not.toThrow()
        expect(cursorEl.getAttribute('display')).toBe('')
    })

    it('downsamples amplitude to the sample interval', async () => {
        const { player, raw } = fakePlayer()
        const engine = new RecordingEngine(player)
        const { options, onSample } = makeOptions()
        await engine.start(options)
        raw.currentTime = 3
        engine.tick()
        socket().fire('open')
        await Promise.resolve()

        onSample.mockClear()
        analyser().sample = 200
        // Two very close ticks (< 1/30s apart in recording time) => second is skipped.
        raw.currentTime = 2.7
        engine.tick()
        expect(onSample).toHaveBeenCalledTimes(1)
        raw.currentTime = 2.71 // 0.01s later, below the 1/30s interval
        engine.tick()
        expect(onSample).toHaveBeenCalledTimes(1)
    })

    it('self-calibrates the waveform gain so quiet capture paths (iOS) still fill the staff', async () => {
        const { player, raw } = fakePlayer()
        const engine = new RecordingEngine(player)
        const { options, onSample } = makeOptions()
        await engine.start(options)
        raw.currentTime = 3
        engine.tick()
        socket().fire('open')
        await Promise.resolve()

        onSample.mockClear()
        // iOS-quiet signal: RMS = 4/128 ≈ 0.031 — the old fixed ×10 gain drew this at ~30%.
        analyser().sample = 132
        raw.currentTime = 2.8
        engine.tick()
        expect((onSample.mock.calls[0][0] as { amp: number }).amp).toBe(1)

        // Half that level renders at ~half height once calibrated.
        analyser().sample = 130
        raw.currentTime = 2.9
        engine.tick()
        const amp = (onSample.mock.calls[1][0] as { amp: number }).amp
        expect(amp).toBeGreaterThan(0.4)
        expect(amp).toBeLessThan(0.6)
    })

    it('keeps the fixed desktop gain for hot mics and never calibrates on sub-gate noise', async () => {
        const { player, raw } = fakePlayer()
        const engine = new RecordingEngine(player)
        const { options, onSample } = makeOptions()
        await engine.start(options)
        raw.currentTime = 3
        engine.tick()
        socket().fire('open')
        await Promise.resolve()

        onSample.mockClear()
        // Room noise (RMS ≈ 0.008, below the gate): stays at the fixed gain, not blown up.
        analyser().sample = 129
        raw.currentTime = 2.8
        engine.tick()
        expect((onSample.mock.calls[0][0] as { amp: number }).amp).toBeCloseTo(0.078, 2)

        // Hot desktop mic (RMS ≈ 0.56): clamps at 1, exactly as the fixed gain did.
        analyser().sample = 200
        raw.currentTime = 2.9
        engine.tick()
        expect((onSample.mock.calls[1][0] as { amp: number }).amp).toBe(1)

        // Moderate desktop level after the hot peak: still the fixed ×10 gain.
        analyser().sample = 136 // RMS = 8/128 = 0.0625
        raw.currentTime = 3.0
        engine.tick()
        expect((onSample.mock.calls[2][0] as { amp: number }).amp).toBeCloseTo(0.625, 2)
    })

    it('triggers onNeedNewMeasure as the cursor nears the end of the current measure', async () => {
        const { player, raw } = fakePlayer()
        const engine = new RecordingEngine(player)
        // Recording region is measures [1..]; start at index 0 so measure 0 is the count-off.
        const { options, onNeedNewMeasure } = makeOptions({ startMeasureIndex: 0, measureCount: 4 })
        await engine.start(options)
        raw.currentTime = 3
        engine.tick()
        socket().fire('open')
        await Promise.resolve()
        onNeedNewMeasure.mockClear()

        // countoffEnd = 2.667s. Put the cursor ~3.5 beats into the recording (within last beat of a 4-beat measure).
        const countoffEnd = (4 * 60) / 90
        const beatsIn = 3.5
        raw.currentTime = countoffEnd + (beatsIn * 60) / 90
        engine.tick()
        expect(onNeedNewMeasure).toHaveBeenCalledTimes(1)

        // Re-ticking in the same measure does not re-trigger (deduped per measureIndex).
        engine.tick()
        expect(onNeedNewMeasure).toHaveBeenCalledTimes(1)
    })

    it('triggers onNeedNewMeasure when the cursor runs off the last measure', async () => {
        const { player, raw } = fakePlayer()
        const engine = new RecordingEngine(player)
        const { options, onNeedNewMeasure } = makeOptions({ startMeasureIndex: 0, measureCount: 2 })
        await engine.start(options)
        raw.currentTime = 3
        engine.tick()
        socket().fire('open')
        await Promise.resolve()
        onNeedNewMeasure.mockClear()

        const countoffEnd = (4 * 60) / 90
        // Way past all 2 measures of recording => measureIndex runs off the end.
        raw.currentTime = countoffEnd + (100 * 60) / 90
        expect(engine.tick()).toBe(false)
        expect(onNeedNewMeasure).toHaveBeenCalled()
    })

    it('forwards score-update websocket messages to onScoreUpdate', async () => {
        const { player, raw } = fakePlayer()
        const engine = new RecordingEngine(player)
        const { options, onScoreUpdate } = makeOptions()
        await engine.start(options)
        raw.currentTime = 3
        engine.tick()
        socket().fire('open')
        await Promise.resolve()

        const measures = { 0: { foo: 'bar' } }
        socket().fire('message', { data: JSON.stringify({ type: 'score-update', measures }) })
        expect(onScoreUpdate).toHaveBeenCalledWith({ measures })

        // Non-string, non-JSON, wrong-type, and missing-measures messages are ignored.
        onScoreUpdate.mockClear()
        socket().fire('message', { data: 123 })
        socket().fire('message', { data: 'not json{' })
        socket().fire('message', { data: JSON.stringify(null) })
        socket().fire('message', { data: JSON.stringify({ type: 'other' }) })
        socket().fire('message', { data: JSON.stringify({ type: 'score-update' }) })
        expect(onScoreUpdate).not.toHaveBeenCalled()
    })

    it('forwards recording-limit messages to onLimitReached with the budget info', async () => {
        const { player, raw } = fakePlayer()
        const engine = new RecordingEngine(player)
        const { options, onLimitReached } = makeOptions()
        await engine.start(options)
        raw.currentTime = 3
        engine.tick()
        socket().fire('open')
        await Promise.resolve()

        socket().fire('message', {
            data: JSON.stringify({
                type: 'recording-limit',
                planId: 'free',
                planName: 'Sketch',
                limitSeconds: 30,
                usedSeconds: 30,
            }),
        })
        expect(onLimitReached).toHaveBeenCalledWith({ planId: 'free', planName: 'Sketch', limitSeconds: 30, usedSeconds: 30 })
    })

    it('fills defaults for a recording-limit message with missing fields', async () => {
        const { player, raw } = fakePlayer()
        const engine = new RecordingEngine(player)
        const { options, onLimitReached } = makeOptions()
        await engine.start(options)
        raw.currentTime = 3
        engine.tick()
        socket().fire('open')
        await Promise.resolve()

        socket().fire('message', { data: JSON.stringify({ type: 'recording-limit' }) })
        expect(onLimitReached).toHaveBeenCalledWith({ planId: 'free', planName: '', limitSeconds: null, usedSeconds: 0 })
    })

    it('forwards recording-error messages to onRecordingError and ignores codeless ones', async () => {
        const { player, raw } = fakePlayer()
        const engine = new RecordingEngine(player)
        const { options, onRecordingError } = makeOptions()
        await engine.start(options)
        raw.currentTime = 3
        engine.tick()
        socket().fire('open')
        await Promise.resolve()

        socket().fire('message', { data: JSON.stringify({ type: 'recording-error', code: 'concurrent-recording' }) })
        expect(onRecordingError).toHaveBeenCalledWith('concurrent-recording')

        onRecordingError.mockClear()
        socket().fire('message', { data: JSON.stringify({ type: 'recording-error' }) })
        expect(onRecordingError).not.toHaveBeenCalled()
    })

    it('tolerates limit/error messages when the optional callbacks are not provided', async () => {
        const { player, raw } = fakePlayer()
        const engine = new RecordingEngine(player)
        const { options } = makeOptions({ onLimitReached: undefined, onRecordingError: undefined })
        await engine.start(options)
        raw.currentTime = 3
        engine.tick()
        socket().fire('open')
        await Promise.resolve()

        expect(() => {
            socket().fire('message', { data: JSON.stringify({ type: 'recording-limit', limitSeconds: 30 }) })
            socket().fire('message', { data: JSON.stringify({ type: 'recording-error', code: 'score-required' }) })
        }).not.toThrow()
    })

    it('media recorder forwards non-empty chunks and drops empty ones', async () => {
        const { player, raw } = fakePlayer()
        const engine = new RecordingEngine(player)
        const { options } = makeOptions()
        await engine.start(options)
        raw.currentTime = 3
        engine.tick()
        socket().fire('open')
        await Promise.resolve()

        socket().sent.length = 0
        recorderOnData()({ data: { size: 0 } })
        expect(socket().sent).toHaveLength(0)
        recorderOnData()({ data: { size: 42 } as never })
        expect(socket().sent).toHaveLength(1)
    })

    it('pulses the cursor opacity on the beat during countoff and clears it once recording starts', async () => {
        const { player, raw } = fakePlayer()
        const engine = new RecordingEngine(player)
        const { options, cursorEl } = makeOptions()
        await engine.start(options)

        // Countoff, on a click (t=0 is the first): full opacity.
        engine.tick()
        expect(Number(cursorEl.getAttribute('fill-opacity'))).toBeCloseTo(1, 3)

        // Countoff, half a beat later (90bpm => beat = 2/3s): decayed toward the trough.
        raw.currentTime = 1 / 3
        engine.tick()
        expect(Number(cursorEl.getAttribute('fill-opacity'))).toBeCloseTo(0.431, 3)

        // Recording (past the 2.667s countoff): the moving cursor takes over, no more pulse.
        raw.currentTime = 3
        engine.tick()
        expect(cursorEl.hasAttribute('fill-opacity')).toBe(false)
        raw.currentTime = 3.1
        engine.tick()
        expect(cursorEl.hasAttribute('fill-opacity')).toBe(false)
    })

    it('clears the cursor pulse when a take is stopped during countoff', async () => {
        const { player, raw } = fakePlayer()
        const engine = new RecordingEngine(player)
        const { options, cursorEl } = makeOptions()
        await engine.start(options)

        raw.currentTime = 1 / 3
        engine.tick()
        expect(cursorEl.hasAttribute('fill-opacity')).toBe(true)

        engine.stop()
        expect(cursorEl.hasAttribute('fill-opacity')).toBe(false)
    })

    it('stop() tears down recorder, stream, socket and analyser and returns to idle', async () => {
        const { player, raw } = fakePlayer()
        const engine = new RecordingEngine(player)
        const { options, cursorEl, onStateChange } = makeOptions()
        const stream = fakeStream()
        getUserMedia.mockResolvedValueOnce(stream)
        await engine.start(options)
        raw.currentTime = 3
        engine.tick()
        socket().fire('open')
        await Promise.resolve()
        recorder().state = 'recording'
        onStateChange.mockClear()

        engine.stop()

        expect(lastRecorder?.stop).toHaveBeenCalled()
        expect(stream.track.stop).toHaveBeenCalled()
        // 'end' frame sent, but the socket stays open: the server is still
        // flushing the take's tail and closes after recording-complete.
        expect(socket().sent.some((s) => typeof s === 'string' && s.includes('"end"'))).toBe(true)
        expect(lastSocket?.close).not.toHaveBeenCalled()
        expect(cursorEl.getAttribute('display')).toBe('none')
        expect(cursorEl.getAttribute('fill')).toBe('#3b82f6')
        expect(engine.state).toBe('idle')
        expect(onStateChange).toHaveBeenLastCalledWith('idle')

        // The server's flush ack arrives => now the socket is closed.
        socket().fire('message', { data: JSON.stringify({ type: 'recording-complete' }) })
        expect(lastSocket?.close).toHaveBeenCalled()
    })

    it('applies score-updates that arrive after stop() while the server drains the take', async () => {
        const { player, raw } = fakePlayer()
        const engine = new RecordingEngine(player)
        const onConnectionLost = vi.fn()
        const { options, onScoreUpdate } = makeOptions()
        options.onConnectionLost = onConnectionLost
        await engine.start(options)
        raw.currentTime = 3
        engine.tick()
        socket().fire('open')
        await Promise.resolve()
        recorder().state = 'recording'

        engine.stop()

        // The final transcription pass lands after the user pressed stop; its
        // notes must still reach the score.
        const measures = { 2: { last: 'notes' } }
        socket().fire('message', { data: JSON.stringify({ type: 'score-update', measures }) })
        expect(onScoreUpdate).toHaveBeenCalledWith({ measures })

        // The server closing after the drain is the expected ending, not a
        // lost connection.
        socket().fire('close')
        expect(onConnectionLost).not.toHaveBeenCalled()
    })

    it('closes the socket itself when the server never acknowledges the end frame', async () => {
        vi.useFakeTimers()
        try {
            const { player, raw } = fakePlayer()
            const engine = new RecordingEngine(player)
            const { options } = makeOptions()
            await engine.start(options)
            raw.currentTime = 3
            engine.tick()
            socket().fire('open')
            await Promise.resolve()
            recorder().state = 'recording'

            engine.stop()
            expect(socket().close).not.toHaveBeenCalled()

            // No recording-complete and no server close => the drain timeout
            // gives up and closes the socket from our side.
            vi.advanceTimersByTime(10_000)
            expect(socket().close).toHaveBeenCalled()
        } finally {
            vi.useRealTimers()
        }
    })

    it('stop() tolerates a recorder whose stop() throws', async () => {
        const { player, raw } = fakePlayer()
        const engine = new RecordingEngine(player)
        const { options } = makeOptions()
        await engine.start(options)
        raw.currentTime = 3
        engine.tick()
        socket().fire('open')
        await Promise.resolve()
        recorder().state = 'recording'
        recorder().stop = vi.fn(() => {
            throw new Error('already gone')
        })
        expect(() => engine.stop()).not.toThrow()
        expect(engine.state).toBe('idle')
    })

    it('stop() does not call recorder.stop() when the recorder is already inactive', async () => {
        const { player, raw } = fakePlayer()
        const engine = new RecordingEngine(player)
        const { options } = makeOptions()
        await engine.start(options)
        raw.currentTime = 3
        engine.tick()
        socket().fire('open')
        await Promise.resolve()
        recorder().state = 'inactive'
        engine.stop()
        expect(recorder().stop).not.toHaveBeenCalled()
    })

    it('stop() tolerates the end-frame send throwing on a half-closed socket', async () => {
        const { player, raw } = fakePlayer()
        const engine = new RecordingEngine(player)
        const { options } = makeOptions()
        await engine.start(options)
        raw.currentTime = 3
        engine.tick()
        socket().fire('open')
        await Promise.resolve()
        // Socket reports OPEN but send() throws mid-teardown.
        socket().send = vi.fn(() => {
            throw new Error('socket closing')
        })
        expect(() => engine.stop()).not.toThrow()
        expect(socket().close).toHaveBeenCalled()
        expect(engine.state).toBe('idle')
    })

    it('stop() skips the end frame when the socket is not open', async () => {
        const { player, raw } = fakePlayer()
        const engine = new RecordingEngine(player)
        const { options } = makeOptions()
        await engine.start(options)
        raw.currentTime = 3
        engine.tick()
        socket().fire('open')
        await Promise.resolve()
        socket().sent.length = 0
        socket().readyState = FakeWebSocket.CLOSED
        engine.stop()
        expect(socket().sent.some((s) => typeof s === 'string' && s.includes('"end"'))).toBe(false)
        expect(socket().close).toHaveBeenCalled()
    })

    it('stop() swallows a rejected analyser-context close', async () => {
        const { player, raw } = fakePlayer()
        const engine = new RecordingEngine(player)
        const { options } = makeOptions()
        await engine.start(options)
        raw.currentTime = 3
        engine.tick()
        socket().fire('open')
        await Promise.resolve()

        // The analyser AudioContext's close() rejects; stop() must absorb it via .catch(() => {}).
        const internal = engine as unknown as { analyserCtx: { close: ReturnType<typeof vi.fn> } | null }
        const analyserCtx = internal.analyserCtx
        if (!analyserCtx) throw new Error('expected an analyser audio context')
        analyserCtx.close = vi.fn(() => Promise.reject(new Error('ctx busy')))
        expect(() => engine.stop()).not.toThrow()
        await Promise.resolve()
        expect(engine.state).toBe('idle')
    })

    it('stop() is a no-op when already idle', () => {
        const { player } = fakePlayer()
        const engine = new RecordingEngine(player)
        engine.stop()
        expect(engine.state).toBe('idle')
    })

    it('stop() during countoff (before any socket/recorder) is safe', async () => {
        const { player } = fakePlayer()
        const engine = new RecordingEngine(player)
        const { options } = makeOptions()
        await engine.start(options)
        expect(engine.state).toBe('countoff')
        expect(() => engine.stop()).not.toThrow()
        expect(engine.state).toBe('idle')
    })

    it('reset() is a no-op (ticker resets are ignored)', () => {
        const { player } = fakePlayer()
        const engine = new RecordingEngine(player)
        expect(() => engine.reset()).not.toThrow()
    })

    it('moveCursor() and paintCursor() are safe no-ops once the session is torn down', () => {
        const { player } = fakePlayer()
        const engine = new RecordingEngine(player)
        // options is null (never started / already stopped) — both guards short-circuit.
        const internal = engine as unknown as { moveCursor(m: number, b: number): void; paintCursor(c: string): void }
        expect(() => internal.moveCursor(0, 0)).not.toThrow()
        expect(() => internal.paintCursor('#000')).not.toThrow()
    })

    it('anchors a sample to a later recording measure once the take crosses into it', async () => {
        const { player, raw } = fakePlayer()
        const engine = new RecordingEngine(player)
        const { options, onSample } = makeOptions({ startMeasureIndex: 0, measureCount: 6 })
        await engine.start(options)
        raw.currentTime = 3
        engine.tick()
        socket().fire('open')
        await Promise.resolve()

        onSample.mockClear()
        analyser().sample = 200
        const countoffEnd = (4 * 60) / 90
        // ~5 beats into the recording => second recording measure.
        raw.currentTime = countoffEnd + (5 * 60) / 90
        engine.tick()
        expect(onSample).toHaveBeenCalledTimes(1)
        const sample = onSample.mock.calls[0][0] as { measureIndex: number; beat: number }
        expect(sample.measureIndex).toBe(1)
        expect(sample.beat).toBeGreaterThanOrEqual(0)
    })

    it('beginStreaming returns immediately when the stream/options are gone', async () => {
        const { player } = fakePlayer()
        const engine = new RecordingEngine(player)
        // Never started: stream and options are null, so beginStreaming bails before opening a socket.
        const internal = engine as unknown as { beginStreaming(): Promise<void> }
        await expect(internal.beginStreaming()).resolves.toBeUndefined()
        expect(lastSocket).toBeNull()
    })

    it('beginStreaming aborts silently when the WebSocket constructor throws', async () => {
        const { player, raw } = fakePlayer()
        const engine = new RecordingEngine(player)
        const { options } = makeOptions()
        // Make the WebSocket constructor throw on this run.
        vi.stubGlobal(
            'WebSocket',
            class {
                static OPEN = 1
                constructor() {
                    throw new Error('refused')
                }
            },
        )
        await engine.start(options)
        raw.currentTime = 3
        // The transition to recording fires beginStreaming, which swallows the throw.
        expect(() => engine.tick()).not.toThrow()
        await Promise.resolve()
        expect(engine.state).toBe('recording')
        // No recorder was created because streaming bailed.
        expect(lastRecorder).toBeNull()
    })

    it('surfaces a connection failure instead of recording into a dead socket', async () => {
        const { player, raw } = fakePlayer()
        const engine = new RecordingEngine(player)
        const onConnectionLost = vi.fn()
        const { options } = makeOptions()
        options.onConnectionLost = onConnectionLost
        await engine.start(options)
        raw.currentTime = 3
        engine.tick()
        // Socket never opens; signal an error and mark it closed so the OPEN guards are false.
        socket().readyState = FakeWebSocket.CLOSED
        socket().fire('error')
        await Promise.resolve()
        await Promise.resolve()
        // No meta frame, no recorder — the user is told the connection failed.
        expect(socket().sent).toHaveLength(0)
        expect(lastRecorder).toBeNull()
        expect(onConnectionLost).toHaveBeenCalled()
    })

    it('fires onConnectionLost when the socket closes mid-take', async () => {
        const { player, raw } = fakePlayer()
        const engine = new RecordingEngine(player)
        const onConnectionLost = vi.fn()
        const { options } = makeOptions()
        options.onConnectionLost = onConnectionLost
        await engine.start(options)
        raw.currentTime = 3
        engine.tick()
        socket().fire('open')
        await Promise.resolve()
        expect(onConnectionLost).not.toHaveBeenCalled()
        socket().fire('close')
        expect(onConnectionLost).toHaveBeenCalledTimes(1)
    })

    it('sends a null timeSignature in meta when the start measure has none', async () => {
        const { player, raw } = fakePlayer()
        const engine = new RecordingEngine(player)
        const score = makeScore(4)
        // Strip the time signature off the count-off measure so the meta serializes null.
        Object.defineProperty(score.measures[1], 'timeSignature', { get: () => undefined, configurable: true })
        const { options } = makeOptions({ score, startMeasureIndex: 1 })
        await engine.start(options)
        raw.currentTime = 3
        engine.tick()
        socket().fire('open')
        await Promise.resolve()
        const meta = JSON.parse(socket().sent[0] as string) as MetaFrame
        expect(meta.timeSignature).toBeNull()
    })

    it('does not forward chunks when the websocket is not open', async () => {
        const { player, raw } = fakePlayer()
        const engine = new RecordingEngine(player)
        const { options } = makeOptions()
        await engine.start(options)
        raw.currentTime = 3
        engine.tick()
        socket().fire('open')
        await Promise.resolve()

        socket().sent.length = 0
        socket().readyState = FakeWebSocket.CLOSED
        recorderOnData()({ data: { size: 99 } as never })
        // Socket not OPEN => chunk dropped (covers the false branch of the OPEN guard).
        expect(socket().sent).toHaveLength(0)
    })

    it('skips moving the cursor when the layout cannot resolve a position', async () => {
        const { player } = fakePlayer()
        const engine = new RecordingEngine(player)
        // resolvePosition returns null => moveCursor bails before touching the cursor element.
        const { options, cursorEl } = makeOptions({ resolvePosition: vi.fn(() => null) })
        await engine.start(options)
        // start() paints the cursor red but the position-based attributes were never set.
        expect(cursorEl.getAttribute('x')).toBeNull()
        expect(cursorEl.getAttribute('fill')).toBe('#ef4444')
    })

    it('findActiveTempo picks the latest tempo when a measure has several (sort comparator)', async () => {
        const { player, raw } = fakePlayer()
        const engine = new RecordingEngine(player)
        const score = makeScore(4)
        // Two tempos in the count-off measure; the later (beat 2 => 240bpm) wins.
        score.measures[1].setTempo(0, 60)
        score.measures[1].addTempo(2, 240)
        const { options, onStateChange } = makeOptions({ score, startMeasureIndex: 1 })
        await engine.start(options)
        // 240bpm, 4 beats => countoff = 4*60/240 = 1s.
        raw.currentTime = 0.9
        engine.tick()
        expect(engine.state).toBe('countoff')
        raw.currentTime = 1.1
        engine.tick()
        expect(onStateChange).toHaveBeenLastCalledWith('recording')
    })

    it('exposes the granted mic settings during a take and clears them on stop', async () => {
        const { player } = fakePlayer()
        const engine = new RecordingEngine(player)
        const { options } = makeOptions()
        // A device that forced voice processing back on despite the constraints.
        getUserMedia.mockResolvedValueOnce(fakeStream({ echoCancellation: true, noiseSuppression: true, autoGainControl: false }))

        expect(engine.micSettings).toBeNull()
        await engine.start(options)
        expect(engine.micSettings).toEqual({ echoCancellation: true, noiseSuppression: true, autoGainControl: false })
        engine.stop()
        expect(engine.micSettings).toBeNull()
    })

    it('tolerates a stream without audio tracks (micSettings stays null)', async () => {
        const { player } = fakePlayer()
        const engine = new RecordingEngine(player)
        const { options } = makeOptions()
        const stream = fakeStream()
        getUserMedia.mockResolvedValueOnce({ ...stream, getAudioTracks: () => [] })

        await engine.start(options)
        expect(engine.micSettings).toBeNull()
        expect(engine.state).toBe('countoff')
    })

    it('declares play-and-record on the audio session before the mic opens and restores auto on stop', async () => {
        const { player } = fakePlayer()
        const engine = new RecordingEngine(player)
        const { options } = makeOptions()
        const audioSession = { type: 'auto' }
        // Capture the session type at the moment the prompt would appear: iOS
        // must know the intent before capture starts, not after.
        let typeWhenPrompted: string | null = null
        const promptingGetUserMedia = vi.fn(() => {
            typeWhenPrompted = audioSession.type
            return Promise.resolve(fakeStream())
        })
        vi.stubGlobal('navigator', { mediaDevices: { getUserMedia: promptingGetUserMedia }, audioSession })

        await engine.start(options)
        expect(typeWhenPrompted).toBe('play-and-record')
        expect(audioSession.type).toBe('play-and-record')

        engine.stop()
        expect(audioSession.type).toBe('auto')
    })

    it('restores the audio session when getUserMedia rejects', async () => {
        const { player } = fakePlayer()
        const engine = new RecordingEngine(player)
        const { options } = makeOptions()
        const audioSession = { type: 'auto' }
        getUserMedia.mockRejectedValueOnce(new DOMException('denied', 'NotAllowedError'))
        vi.stubGlobal('navigator', { mediaDevices: { getUserMedia }, audioSession })

        await expect(engine.start(options)).rejects.toThrow()
        expect(audioSession.type).toBe('auto')
    })

    it('restores the audio session when stop() races the permission prompt', async () => {
        const { player } = fakePlayer()
        const engine = new RecordingEngine(player)
        const { options } = makeOptions()
        const audioSession = { type: 'auto' }
        let resolvePrompt: (stream: unknown) => void = () => {}
        const pendingGetUserMedia = vi.fn(() => new Promise((resolve) => (resolvePrompt = resolve)))
        vi.stubGlobal('navigator', { mediaDevices: { getUserMedia: pendingGetUserMedia }, audioSession })

        const started = engine.start(options)
        expect(audioSession.type).toBe('play-and-record')
        engine.stop() // user bails while the prompt is open
        expect(audioSession.type).toBe('auto')
        const stream = fakeStream()
        resolvePrompt(stream)
        await started
        // The raced start released the stream and left the session restored.
        expect(stream.track.stop).toHaveBeenCalled()
        expect(audioSession.type).toBe('auto')
        expect(engine.micSettings).toBeNull()
    })

    it('start() throws RecordingUnsupportedError when mediaDevices is unavailable', async () => {
        const { player } = fakePlayer()
        const engine = new RecordingEngine(player)
        const { options } = makeOptions()

        // Insecure context / ancient browser: navigator exists but mediaDevices doesn't.
        vi.stubGlobal('navigator', {})
        await expect(engine.start(options)).rejects.toBeInstanceOf(RecordingUnsupportedError)
        expect(engine.state).toBe('idle')

        // No navigator at all (defensive; e.g. a non-browser environment).
        vi.stubGlobal('navigator', undefined)
        await expect(engine.start(options)).rejects.toBeInstanceOf(RecordingUnsupportedError)
        expect(engine.state).toBe('idle')
    })

    it('records with the first isTypeSupported()-approved format and announces it in meta', async () => {
        const { player, raw } = fakePlayer()
        const engine = new RecordingEngine(player)
        const { options } = makeOptions()
        // A Safari-like browser: only MP4 recording is available.
        class Mp4OnlyRecorder extends FakeMediaRecorder {
            static isTypeSupported = vi.fn((type: string) => type === 'audio/mp4')
        }
        vi.stubGlobal('MediaRecorder', Mp4OnlyRecorder)

        await engine.start(options)
        raw.currentTime = 3
        engine.tick()
        socket().fire('open')
        await Promise.resolve()
        await Promise.resolve()

        // Preferred Opus flavors were probed first, in order.
        expect(Mp4OnlyRecorder.isTypeSupported.mock.calls.map(([t]) => t)).toEqual([
            'audio/webm;codecs=opus',
            'audio/webm',
            'audio/ogg;codecs=opus',
            'audio/mp4',
        ])
        expect(recorder().options).toEqual({ mimeType: 'audio/mp4' })
        const meta = JSON.parse(socket().sent[0] as string) as MetaFrame
        expect(meta.mimeType).toBe('audio/mp4')
    })

    it('falls back to the browser-default encoding when isTypeSupported is missing', async () => {
        const { player, raw } = fakePlayer()
        const engine = new RecordingEngine(player)
        const { options } = makeOptions()
        // FakeMediaRecorder has no static isTypeSupported — pre-2021 Safari.

        await engine.start(options)
        raw.currentTime = 3
        engine.tick()
        socket().fire('open')
        await Promise.resolve()
        await Promise.resolve()

        expect(recorder().options).toBeUndefined()
        const meta = JSON.parse(socket().sent[0] as string) as MetaFrame
        expect(meta.mimeType).toBeNull()
    })

    it('falls back to the browser-default encoding when no candidate is supported', async () => {
        const { player, raw } = fakePlayer()
        const engine = new RecordingEngine(player)
        const { options } = makeOptions()
        class NoFormatRecorder extends FakeMediaRecorder {
            static isTypeSupported = vi.fn(() => false)
        }
        vi.stubGlobal('MediaRecorder', NoFormatRecorder)

        await engine.start(options)
        raw.currentTime = 3
        engine.tick()
        socket().fire('open')
        await Promise.resolve()
        await Promise.resolve()

        expect(recorder().options).toBeUndefined()
        const meta = JSON.parse(socket().sent[0] as string) as MetaFrame
        expect(meta.mimeType).toBeNull()
    })

    it('uses the active tempo when computing the countoff window', async () => {
        const { player, raw } = fakePlayer()
        const engine = new RecordingEngine(player)
        const score = makeScore(4)
        score.measures[0].setTempo(0, 120)
        const { options, onStateChange } = makeOptions({ score, startMeasureIndex: 1 })
        await engine.start(options)

        // 120bpm, 4 beats => countoff = 4*60/120 = 2s. Just under should still be countoff.
        raw.currentTime = 1.9
        engine.tick()
        expect(engine.state).toBe('countoff')
        raw.currentTime = 2.1
        engine.tick()
        expect(onStateChange).toHaveBeenLastCalledWith('recording')
    })
})
