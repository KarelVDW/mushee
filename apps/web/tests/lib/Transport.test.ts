import { makeScore, pitched } from '@test/helpers'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { MidiPlayer, ScheduledNote } from '@/lib/MidiPlayer'
import { Transport } from '@/lib/Transport'
import { Instrument } from '@/model/Instrument'
import type { Score } from '@/model/Score'

// --- Browser stubs so the recording engine can start inside record() -------
class FakeAnalyser {
    fftSize = 2048
    connect = vi.fn()
    getByteTimeDomainData = vi.fn((arr: Uint8Array) => arr.fill(128))
}
class FakeAudioContext {
    createMediaStreamSource = vi.fn(() => ({ connect: vi.fn() }))
    createAnalyser = vi.fn(() => new FakeAnalyser())
    close = vi.fn(() => Promise.resolve())
}
class FakeMediaRecorder {
    state: 'inactive' | 'recording' = 'inactive'
    ondataavailable: ((e: { data: { size: number } }) => void) | null = null
    onstop: (() => void) | null = null
    start = vi.fn(() => {
        this.state = 'recording'
    })
    stop = vi.fn(() => {
        this.state = 'inactive'
        this.onstop?.()
    })
    constructor(public stream: unknown) {}
}
class FakeWebSocket {
    static OPEN = 1
    readyState = FakeWebSocket.OPEN
    send = vi.fn()
    close = vi.fn()
    addEventListener = vi.fn()
    constructor(public url: string) {}
}

function fakeStream() {
    const track = { stop: vi.fn() }
    return { getTracks: () => [track], track }
}

/** A MidiPlayer double: manual clock plus a log of every scheduled note. */
function fakePlayer() {
    const scheduled: ScheduledNote[] = []
    const raw = {
        currentTime: 0,
        scheduled,
        start: vi.fn(),
        stop: vi.fn(),
        pause: vi.fn(),
        resume: vi.fn(),
        dispose: vi.fn(),
        schedule: vi.fn((note: ScheduledNote) => {
            scheduled.push(note)
        }),
    }
    return { player: raw as unknown as MidiPlayer, raw }
}

function svgRect(): SVGRectElement {
    return document.createElementNS('http://www.w3.org/2000/svg', 'rect')
}

/** A score whose first measure opens with a real pitched note. */
function scoreWithNotes(measures = 4): Score {
    const score = makeScore(measures)
    const first = score.measures[0].notes[0]
    score.replace([first], [pitched('C', 4)])
    return score
}

const resolvePosition = () => ({ x: 0, rowY: 0 })

function recordingOptions(score: Score, over: Record<string, unknown> = {}) {
    return {
        score,
        startMeasureIndex: 0,
        cursorEl: svgRect(),
        resolvePosition,
        wsUrl: 'ws://localhost/stream',
        onStateChange: vi.fn(),
        onNeedNewMeasure: vi.fn(),
        ...over,
    }
}

describe('Transport', () => {
    let frames: Array<() => void>

    beforeEach(() => {
        frames = []
        vi.stubGlobal('requestAnimationFrame', (cb: () => void) => {
            frames.push(cb)
            return frames.length
        })
        vi.stubGlobal('cancelAnimationFrame', vi.fn())
        vi.stubGlobal('navigator', { mediaDevices: { getUserMedia: vi.fn(() => Promise.resolve(fakeStream())) } })
        vi.stubGlobal('AudioContext', FakeAudioContext)
        vi.stubGlobal('MediaRecorder', FakeMediaRecorder)
        vi.stubGlobal('WebSocket', FakeWebSocket)
    })

    afterEach(() => {
        vi.unstubAllGlobals()
        vi.restoreAllMocks()
    })

    function fireFrame() {
        const cb = frames.pop()
        if (!cb) throw new Error('no frame scheduled')
        cb()
    }

    it('playScore schedules the score notes and enters playing mode', () => {
        const { player, raw } = fakePlayer()
        const transport = new Transport(player)
        const score = scoreWithNotes()

        transport.playScore({ score, startNote: null, cursorEl: svgRect(), resolvePosition })
        expect(transport.mode).toBe('playing')
        expect(raw.start).toHaveBeenCalled()

        fireFrame()
        expect(raw.scheduled.some((n) => n.instrument === score.instrument)).toBe(true)
    })

    it('playScore without the metronome enabled schedules no clicks', () => {
        const { player, raw } = fakePlayer()
        const transport = new Transport(player)

        transport.playScore({ score: scoreWithNotes(), startNote: null, cursorEl: svgRect(), resolvePosition })
        fireFrame()
        expect(raw.scheduled.some((n) => n.instrument === Instrument.Woodblock)).toBe(false)
    })

    it('playScore with the metronome enabled schedules clicks too', () => {
        const { player, raw } = fakePlayer()
        const transport = new Transport(player)
        transport.setMetronomeEnabled(true)

        transport.playScore({ score: scoreWithNotes(), startNote: null, cursorEl: svgRect(), resolvePosition })
        fireFrame()
        expect(raw.scheduled.some((n) => n.instrument === Instrument.Woodblock)).toBe(true)
    })

    it('recording never replays the score notes a previous playback left behind', async () => {
        const { player, raw } = fakePlayer()
        const transport = new Transport(player)
        const score = scoreWithNotes()

        // A playback pass primes the scheduler with the score and its notes…
        transport.playScore({ score, startNote: null, cursorEl: svgRect(), resolvePosition })
        fireFrame()
        transport.stop()
        raw.scheduled.length = 0

        // …then a recording starts in that same region. Only metronome clicks
        // may sound — the note scheduler must not be part of the recording pass.
        await transport.record(recordingOptions(score))
        expect(transport.mode).toBe('recording')
        fireFrame()
        fireFrame()

        expect(raw.scheduled.length).toBeGreaterThan(0)
        expect(raw.scheduled.every((n) => n.instrument === Instrument.Woodblock)).toBe(true)
    })

    it('record always includes the metronome click, whatever the toggle says', async () => {
        const { player, raw } = fakePlayer()
        const transport = new Transport(player)
        transport.setMetronomeEnabled(false)

        await transport.record(recordingOptions(scoreWithNotes()))
        fireFrame()
        expect(raw.scheduled.some((n) => n.instrument === Instrument.Woodblock)).toBe(true)
    })

    it('pause/resume freeze and restart the clock without leaving playing/paused modes wrongly', () => {
        const { player, raw } = fakePlayer()
        const transport = new Transport(player)

        transport.playScore({ score: scoreWithNotes(), startNote: null, cursorEl: svgRect(), resolvePosition })
        transport.pause()
        expect(transport.mode).toBe('paused')
        expect(raw.pause).toHaveBeenCalled()

        transport.resume()
        expect(transport.mode).toBe('playing')
        expect(raw.resume).toHaveBeenCalled()

        // pause() outside playing and resume() outside paused are no-ops.
        transport.stop()
        transport.pause()
        transport.resume()
        expect(transport.mode).toBe('stopped')
    })

    it('setMetronomeEnabled mid-playback joins without burst-scheduling elapsed clicks', () => {
        const { player, raw } = fakePlayer()
        const transport = new Transport(player)
        const score = scoreWithNotes()

        transport.playScore({ score, startNote: null, cursorEl: svgRect(), resolvePosition })
        // 90bpm default: 3 seconds in = 4.5 beats already elapsed.
        raw.currentTime = 3
        transport.setMetronomeEnabled(true)
        // Let the clock reach the joined metronome's next upcoming click.
        raw.currentTime = 3.5
        fireFrame()

        const clicks = raw.scheduled.filter((n) => n.instrument === Instrument.Woodblock)
        // Only upcoming clicks get scheduled; the ~5 elapsed ones are skipped.
        expect(clicks.length).toBeGreaterThan(0)
        expect(clicks.every((n) => n.startTime > 3)).toBe(true)

        // Toggling off removes it again: no new clicks on later frames.
        transport.setMetronomeEnabled(false)
        const clickCount = raw.scheduled.filter((n) => n.instrument === Instrument.Woodblock).length
        raw.currentTime = 6
        fireFrame()
        expect(raw.scheduled.filter((n) => n.instrument === Instrument.Woodblock).length).toBe(clickCount)
    })

    it('setMetronomeEnabled while stopped only stores the preference', () => {
        const { player } = fakePlayer()
        const transport = new Transport(player)
        transport.setMetronomeEnabled(true)
        transport.setMetronomeEnabled(true) // idempotent
        expect(transport.metronomeEnabled).toBe(true)
    })

    it('record rethrows engine start failures and stays stopped', async () => {
        const { player } = fakePlayer()
        const transport = new Transport(player)
        vi.stubGlobal('navigator', {
            mediaDevices: { getUserMedia: vi.fn(() => Promise.reject(new DOMException('denied', 'NotAllowedError'))) },
        })

        await expect(transport.record(recordingOptions(scoreWithNotes()))).rejects.toThrow()
        expect(transport.mode).toBe('stopped')
        expect(transport.isRecording).toBe(false)
    })

    it('a stop() racing the mic prompt leaves no zombie pass behind', async () => {
        const { player, raw } = fakePlayer()
        const transport = new Transport(player)

        let releaseMic: (value: ReturnType<typeof fakeStream>) => void = () => {}
        vi.stubGlobal('navigator', {
            mediaDevices: { getUserMedia: vi.fn(() => new Promise((resolve) => (releaseMic = resolve))) },
        })

        const pending = transport.record(recordingOptions(scoreWithNotes()))
        transport.stop() // user bails while the permission prompt is open
        releaseMic(fakeStream())
        await pending

        expect(transport.mode).toBe('stopped')
        // The clock was never restarted for a dead session.
        expect(raw.start).not.toHaveBeenCalled()
    })

    it('stop() ends a recording session and is idempotent', async () => {
        const { player } = fakePlayer()
        const transport = new Transport(player)

        await transport.record(recordingOptions(scoreWithNotes()))
        expect(transport.isRecording).toBe(true)

        transport.stop()
        expect(transport.isRecording).toBe(false)
        expect(transport.mode).toBe('stopped')
        transport.stop()
        expect(transport.mode).toBe('stopped')
    })

    it('dispose stops everything and releases the player', () => {
        const { player, raw } = fakePlayer()
        const transport = new Transport(player)
        transport.playScore({ score: scoreWithNotes(), startNote: null, cursorEl: svgRect(), resolvePosition })
        transport.dispose()
        expect(transport.mode).toBe('stopped')
        expect(raw.dispose).toHaveBeenCalled()
    })
})
