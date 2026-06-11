import { makeScore } from '@test/helpers'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { MidiPlayer } from '@/lib/MidiPlayer'
import { RecordingEngine, type RecordingOptions } from '@/lib/RecordingEngine'
import type { Score } from '@/model/Score'

// Shape of the JSON `meta` frame the engine sends when streaming opens.
interface MetaFrame {
    type: string
    bpm: number
    timeSignature: { beats: number; beatType: number } | null
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
    start = vi.fn((_ms?: number) => {
        this.state = 'recording'
    })
    stop = vi.fn(() => {
        this.state = 'inactive'
    })
    constructor(public stream: unknown) {
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
function fakeStream() {
    const track = { stop: vi.fn() }
    return { getTracks: () => [track], track }
}

function fakePlayer(currentTime = 0) {
    const raw = { currentTime }
    return { player: raw as unknown as MidiPlayer, raw }
}

function svgRect(): SVGRectElement {
    return document.createElementNS('http://www.w3.org/2000/svg', 'rect')
}
function svgPath(): SVGPathElement {
    return document.createElementNS('http://www.w3.org/2000/svg', 'path')
}

/**
 * Build options for a recording starting at `startMeasureIndex`. The score has
 * `measureCount` 4/4 measures. `resolvePosition` returns a stub layout point.
 */
function makeOptions(over: Partial<RecordingOptions> & { measureCount?: number } = {}) {
    const measureCount = over.measureCount ?? 4
    const score: Score = (over.score as Score) ?? makeScore(measureCount)
    const cursorEl = svgRect()
    const waveformEl = svgPath()
    const onStateChange = vi.fn()
    const onNeedNewMeasure = vi.fn()
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
        waveformEl,
        resolvePosition,
        wsUrl: 'ws://localhost/stream',
        onStateChange,
        onNeedNewMeasure,
        onScoreUpdate,
        onLimitReached,
        onRecordingError,
        ...over,
    }
    return {
        options,
        score,
        cursorEl,
        waveformEl,
        onStateChange,
        onNeedNewMeasure,
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

        expect(getUserMedia).toHaveBeenCalledWith({ audio: true })
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

    it('moves the cursor during recording and samples the waveform', async () => {
        const { player, raw } = fakePlayer()
        const engine = new RecordingEngine(player)
        const { options, cursorEl, waveformEl, resolvePosition } = makeOptions()
        await engine.start(options)

        // Force into recording.
        raw.currentTime = 3
        engine.tick()
        socket().fire('open')
        await Promise.resolve()

        resolvePosition.mockClear()
        // Make the analyser produce a non-zero RMS so the waveform path is non-empty.
        analyser().sample = 200
        // A little past the countoff end => first recording measure, beat ~0.x.
        raw.currentTime = 2.8
        engine.tick()

        expect(cursorEl.getAttribute('display')).toBe('')
        expect(resolvePosition).toHaveBeenCalled()
        // Waveform path was painted with at least one stroke.
        expect(waveformEl.getAttribute('d')).toMatch(/^M/)
    })

    it('records without a waveform element (waveformEl null)', async () => {
        const { player, raw } = fakePlayer()
        const engine = new RecordingEngine(player)
        const { options, cursorEl } = makeOptions({ waveformEl: null })
        await engine.start(options)
        raw.currentTime = 3
        engine.tick()
        socket().fire('open')
        await Promise.resolve()

        analyser().sample = 200
        raw.currentTime = 2.8
        // updateWaveform short-circuits on the missing waveform element; the cursor still moves.
        expect(() => engine.tick()).not.toThrow()
        expect(cursorEl.getAttribute('display')).toBe('')
    })

    it('downsamples waveform samples to the sample interval', async () => {
        const { player, raw } = fakePlayer()
        const engine = new RecordingEngine(player)
        const { options, waveformEl } = makeOptions()
        await engine.start(options)
        raw.currentTime = 3
        engine.tick()
        socket().fire('open')
        await Promise.resolve()

        analyser().sample = 200
        // Two very close ticks (< 1/30s apart in recording time) => second is skipped.
        raw.currentTime = 2.7
        engine.tick()
        const after1 = waveformEl.getAttribute('d')
        raw.currentTime = 2.71 // 0.01s later, below the 1/30s interval
        engine.tick()
        const after2 = waveformEl.getAttribute('d')
        expect(after2).toBe(after1)
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
        // 'end' frame sent then socket closed.
        expect(socket().sent.some((s) => typeof s === 'string' && s.includes('"end"'))).toBe(true)
        expect(lastSocket?.close).toHaveBeenCalled()
        expect(cursorEl.getAttribute('display')).toBe('none')
        expect(cursorEl.getAttribute('fill')).toBe('#3b82f6')
        expect(engine.state).toBe('idle')
        expect(onStateChange).toHaveBeenLastCalledWith('idle')
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

    it('paints the waveform for a sample that spans into a later recording measure', async () => {
        const { player, raw } = fakePlayer()
        const engine = new RecordingEngine(player)
        const { options, waveformEl, resolvePosition } = makeOptions({ startMeasureIndex: 0, measureCount: 6 })
        await engine.start(options)
        raw.currentTime = 3
        engine.tick()
        socket().fire('open')
        await Promise.resolve()

        analyser().sample = 200
        const countoffEnd = (4 * 60) / 90
        // ~5 beats into the recording => second recording measure: the updateWaveform
        // while-loop subtracts the first measure's beats and advances measureIndex.
        raw.currentTime = countoffEnd + (5 * 60) / 90
        engine.tick()
        const d = waveformEl.getAttribute('d') ?? ''
        expect(d).toMatch(/^M/)
        // The sample resolved to a later measure (index >= 1), proving the while-loop advanced.
        const resolvedLaterMeasure = resolvePosition.mock.calls.some(([measureIndex]) => measureIndex >= 1)
        expect(resolvedLaterMeasure).toBe(true)
    })

    it('skips waveform samples that fall beyond the available measures', async () => {
        const { player, raw } = fakePlayer()
        const engine = new RecordingEngine(player)
        const { options, waveformEl } = makeOptions({ startMeasureIndex: 0, measureCount: 2 })
        await engine.start(options)
        raw.currentTime = 3
        engine.tick()
        socket().fire('open')
        await Promise.resolve()

        // Sample a valid in-range point first so there is an entry, then a far-off point.
        analyser().sample = 200
        const countoffEnd = (4 * 60) / 90
        raw.currentTime = countoffEnd + (0.5 * 60) / 90
        engine.tick()
        const afterInRange = waveformEl.getAttribute('d')

        // Now sample beyond all recording measures (handled by tick's own off-end guard),
        // and force updateWaveform to also see an out-of-range sample by manipulating samples.
        const internal = engine as unknown as { samples: { time: number; amp: number }[]; updateWaveform(): void }
        internal.samples.push({ time: 9999, amp: 0.5 }) // far beyond all measures => continue
        internal.updateWaveform()
        // The out-of-range sample contributes nothing extra beyond the in-range stroke(s).
        expect((waveformEl.getAttribute('d') ?? '').startsWith(afterInRange ?? '')).toBe(true)
    })

    it('skips waveform samples whose position cannot be resolved', async () => {
        const { player, raw } = fakePlayer()
        const engine = new RecordingEngine(player)
        const resolvePosition = vi.fn(
        (measureIndex: number, beat: number): { x: number; rowY: number } | null => ({ x: measureIndex * 100 + beat * 10, rowY: 0 }),
    )
        const { options, waveformEl } = makeOptions({ resolvePosition, measureCount: 4 })
        await engine.start(options)
        raw.currentTime = 3
        engine.tick()
        socket().fire('open')
        await Promise.resolve()

        // Record one in-range sample.
        analyser().sample = 200
        const countoffEnd = (4 * 60) / 90
        raw.currentTime = countoffEnd + (0.5 * 60) / 90
        engine.tick()

        // Now make resolvePosition return null and force a waveform repaint.
        resolvePosition.mockReturnValue(null)
        const internal = engine as unknown as { updateWaveform(): void }
        internal.updateWaveform()
        // Every sample resolved to null => the path is cleared (no strokes).
        expect(waveformEl.getAttribute('d')).toBe('')
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

    it('resolves beginStreaming on a socket error and skips meta when not OPEN', async () => {
        const { player, raw } = fakePlayer()
        const engine = new RecordingEngine(player)
        const { options } = makeOptions()
        await engine.start(options)
        raw.currentTime = 3
        engine.tick()
        // Socket never opens; signal an error and mark it closed so the OPEN guards are false.
        socket().readyState = FakeWebSocket.CLOSED
        socket().fire('error')
        await Promise.resolve()
        await Promise.resolve()
        // No meta frame was sent (socket not OPEN), but a recorder was still created.
        expect(socket().sent).toHaveLength(0)
        expect(lastRecorder).not.toBeNull()
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
