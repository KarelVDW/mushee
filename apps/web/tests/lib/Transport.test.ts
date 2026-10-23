import { Instrument, Score } from '@mushee/notation/model'
import { makeScore, pitched, rest } from '@mushee/notation/testing'
import { Metronome } from '@mushee/playback/Metronome'
import type { MidiPlayer, ScheduledNote } from '@mushee/playback/MidiPlayer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { Transport } from '@/lib/Transport'

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
    const track = { stop: vi.fn(), getSettings: vi.fn(() => ({})) }
    return { getTracks: () => [track], getAudioTracks: () => [track], track }
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
        loadInstruments: vi.fn(() => Promise.resolve()),
        preview: vi.fn(),
        schedule: vi.fn((note: ScheduledNote) => {
            scheduled.push(note)
        }),
    }
    return { player: raw as unknown as MidiPlayer, raw }
}

function svgPlayhead(): SVGGElement {
    return document.createElementNS('http://www.w3.org/2000/svg', 'g')
}

/** A score whose first measure opens with a real pitched note. */
function scoreWithNotes(measures = 4): Score {
    const score = makeScore(measures)
    const first = score.measures[0].notes[0]
    score.replace([first], [pitched('C', 4)])
    return score
}

function recordingOptions(score: Score, over: Record<string, unknown> = {}) {
    return {
        score,
        startMeasureIndex: 0,
        cursorEl: svgPlayhead(),
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

        transport.playScore({ score, startNote: null, cursorEl: svgPlayhead() })
        expect(transport.mode).toBe('playing')
        expect(raw.start).toHaveBeenCalled()

        fireFrame()
        expect(raw.scheduled.some((n) => n.instrument === score.instrument)).toBe(true)
    })

    it('each pass draws the cursor into its own element, at the layout point of the playing beat', () => {
        const { player, raw } = fakePlayer()
        const transport = new Transport(player)
        const score = scoreWithNotes()
        const first = svgPlayhead()
        const second = svgPlayhead()

        transport.playScore({ score, startNote: null, cursorEl: first })
        transport.stop()
        transport.playScore({ score, startNote: null, cursorEl: second })
        // Schedule the pass, then let the cursor follow it half a quarter in (90bpm).
        fireFrame()
        raw.currentTime = 30 / 90
        fireFrame()

        const point = score.layout.pointAtBeat(score.measures[0], 0.5)
        expect(second.getAttribute('transform')).toBe(`translate(${point.x}, ${point.rowY})`)
        expect(first.getAttribute('transform')).toBeNull()
    })

    it('playScore without the metronome enabled schedules no clicks', () => {
        const { player, raw } = fakePlayer()
        const transport = new Transport(player)

        transport.playScore({ score: scoreWithNotes(), startNote: null, cursorEl: svgPlayhead() })
        fireFrame()
        expect(raw.scheduled.some((n) => n.instrument === Instrument.Woodblock)).toBe(false)
    })

    it('playScore with the metronome enabled schedules clicks too', () => {
        const { player, raw } = fakePlayer()
        const transport = new Transport(player)
        transport.setMetronomeEnabled(true)

        transport.playScore({ score: scoreWithNotes(), startNote: null, cursorEl: svgPlayhead() })
        fireFrame()
        expect(raw.scheduled.some((n) => n.instrument === Instrument.Woodblock)).toBe(true)
    })

    it('recording never replays the score notes a previous playback left behind', async () => {
        const { player, raw } = fakePlayer()
        const transport = new Transport(player)
        const score = scoreWithNotes()

        // A playback pass primes the scheduler with the score and its notes…
        transport.playScore({ score, startNote: null, cursorEl: svgPlayhead() })
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

        transport.playScore({ score: scoreWithNotes(), startNote: null, cursorEl: svgPlayhead() })
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

    it('reports every mode change, including a pass that plays out on its own', async () => {
        const { player, raw } = fakePlayer()
        const transport = new Transport(player)
        const modes: string[] = []
        transport.onModeChange = (mode) => modes.push(mode)

        transport.playScore({ score: scoreWithNotes(1), startNote: null, cursorEl: svgPlayhead() })
        transport.pause()
        transport.resume()
        // Far past the score's end: the ticker finishes the pass without a stop().
        raw.currentTime = 1000
        fireFrame()
        expect(transport.mode).toBe('stopped')
        expect(modes).toEqual(['stopped', 'playing', 'paused', 'playing', 'stopped'])

        modes.length = 0
        await transport.record(recordingOptions(scoreWithNotes()))
        transport.stop()
        expect(modes).toEqual(['stopped', 'recording', 'stopped'])
    })

    it('setMetronomeEnabled mid-playback joins without burst-scheduling elapsed clicks', () => {
        const { player, raw } = fakePlayer()
        const transport = new Transport(player)
        const score = scoreWithNotes()

        transport.playScore({ score, startNote: null, cursorEl: svgPlayhead() })
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

    it('a tempo edit mid-pass keeps the clicks on the notes and nothing in the past', () => {
        const { player, raw } = fakePlayer()
        const transport = new Transport(player)
        transport.setMetronomeEnabled(true)
        const score = new Score()
        // Half notes: when the edit lands, the scheduler has walked to beat 2 while the next click is due at beat 1.
        for (let i = 0; i < 3; i++) score.addMeasure(i).addNotes([pitched('C', 4, 'h'), pitched('D', 4, 'h')])
        score.measures[0].setTempo(0, 60)

        let late = 0
        const playUntil = (from: number, to: number) => {
            // Until the pass plays out (the ticker then asks for no more frames).
            for (let frame = 0; from + frame / 60 < to && transport.mode === 'playing'; frame++) {
                raw.currentTime = from + frame / 60
                const before = raw.scheduled.length
                fireFrame()
                late += raw.scheduled.slice(before).filter((n) => n.startTime < raw.currentTime - 1e-9).length
            }
        }
        transport.playScore({ score, startNote: null, cursorEl: svgPlayhead() })
        playUntil(0, 4.5)
        // The dock's tempo field edits the marking upstream without touching the selection.
        score.measures[0].setTempo(0, 30)
        playUntil(4.5, 20)

        expect(late).toBe(0)
        const clicks = raw.scheduled.filter((n) => n.instrument === Instrument.Woodblock).map((n) => n.startTime)
        const notes = raw.scheduled.filter((n) => n.instrument === score.instrument).map((n) => n.startTime)
        // The click due at 5s keeps its time; the rest follow at the new tempo, and every note lands on a click.
        expect(clicks).toEqual([0, 1, 2, 3, 4, 5, 7, 9, 11, 13, 15, 17])
        expect(notes).toEqual([0, 2, 4, 7, 11, 15])
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

    it('record resolves to the granted mic settings, or null when the take never started', async () => {
        const { player } = fakePlayer()
        const transport = new Transport(player)

        await expect(transport.record(recordingOptions(scoreWithNotes()))).resolves.toEqual({})
        transport.stop()

        let releaseMic: (value: ReturnType<typeof fakeStream>) => void = () => {}
        vi.stubGlobal('navigator', {
            mediaDevices: { getUserMedia: vi.fn(() => new Promise((resolve) => (releaseMic = resolve))) },
        })
        const pending = transport.record(recordingOptions(scoreWithNotes()))
        transport.stop() // the user bails while the permission prompt is open
        releaseMic(fakeStream())
        await expect(pending).resolves.toBeNull()
    })

    it('prepare loads the instrument with the metronome click, or alone when the page never clicks', async () => {
        const { player, raw } = fakePlayer()
        const transport = new Transport(player)

        await transport.prepare(Instrument.Flute)
        expect(raw.loadInstruments).toHaveBeenLastCalledWith([Instrument.Flute, Metronome.INSTRUMENT])
        await transport.prepare(Instrument.Flute, { metronome: false })
        expect(raw.loadInstruments).toHaveBeenLastCalledWith([Instrument.Flute])
    })

    it("preview sounds a note at its instrument's sounding pitch, and a rest not at all", () => {
        const { player, raw } = fakePlayer()
        const transport = new Transport(player)
        const score = scoreWithNotes()
        // Clarinet sounds a major second below written pitch; seedInstrument keeps the written C.
        score.seedInstrument(Instrument.Clarinet)
        const note = score.measures[0].notes[0]
        if (!note.pitch) throw new Error('expected a pitched note')

        transport.preview(score, note)
        expect(raw.preview).toHaveBeenCalledWith(note.pitch.toMidi() + Instrument.Clarinet.chromaticTranspose, 0.75, Instrument.Clarinet)

        raw.preview.mockClear()
        transport.preview(score, rest())
        expect(raw.preview).not.toHaveBeenCalled()
    })

    it('dispose stops everything and releases the player', () => {
        const { player, raw } = fakePlayer()
        const transport = new Transport(player)
        transport.playScore({ score: scoreWithNotes(), startNote: null, cursorEl: svgPlayhead() })
        transport.dispose()
        expect(transport.mode).toBe('stopped')
        expect(raw.dispose).toHaveBeenCalled()
    })
})
