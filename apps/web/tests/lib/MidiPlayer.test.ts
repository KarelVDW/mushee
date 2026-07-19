import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { Instrument } from '@/model/Instrument'

// --- smplr mock -------------------------------------------------------------
// Each Soundfont instance records its start() calls and returns a stop fn we can spy on.
const soundfontInstances: Array<{ start: ReturnType<typeof vi.fn>; disconnect: ReturnType<typeof vi.fn>; opts: unknown }> = []
const stopFns: Array<ReturnType<typeof vi.fn>> = []

vi.mock('smplr', () => ({
    // A regular function (not an arrow) so it can be invoked with `new`.
    Soundfont: vi.fn().mockImplementation(function (this: unknown, _ctx: unknown, opts: unknown) {
        const start = vi.fn(() => {
            const stop = vi.fn()
            stopFns.push(stop)
            return stop
        })
        const inst = { loaded: () => Promise.resolve(), start, disconnect: vi.fn(), opts }
        soundfontInstances.push(inst)
        return inst
    }),
}))

// --- AudioContext stub ------------------------------------------------------
class FakeAudioContext {
    static created: FakeAudioContext[] = []
    currentTime = 0
    state: 'running' | 'suspended' | 'closed' = 'running'
    resume = vi.fn(() => Promise.resolve())
    suspend = vi.fn(() => Promise.resolve())
    close = vi.fn(() => Promise.resolve())
    constructor() {
        FakeAudioContext.created.push(this)
    }
}

// Imported after the mocks are registered.
import { Soundfont } from 'smplr'

import { MidiPlayer } from '@/lib/MidiPlayer'

describe('MidiPlayer', () => {
    beforeEach(() => {
        soundfontInstances.length = 0
        stopFns.length = 0
        FakeAudioContext.created.length = 0
        vi.stubGlobal('AudioContext', FakeAudioContext)
    })

    afterEach(() => {
        vi.unstubAllGlobals()
        // mockClear() wipes call history but KEEPS the mockImplementation, so
        // `new Soundfont(...)` still works in the next test (unlike clear/resetAllMocks).
        vi.mocked(Soundfont).mockClear()
    })

    it('currentTime is 0 and isActive false before any context exists', () => {
        const player = new MidiPlayer()
        expect(player.currentTime).toBe(0)
        expect(player.isActive).toBe(false)
    })

    it('start() creates a context, resumes if suspended, and seeds the offset', () => {
        const player = new MidiPlayer()
        player.start()
        const ctx = FakeAudioContext.created[0]
        expect(player.isActive).toBe(true)
        // state defaults to 'running', so resume is not forced — but starting again from suspended should resume.
        ctx.state = 'suspended'
        player.start()
        expect(ctx.resume).toHaveBeenCalled()
    })

    it('currentTime is measured relative to the start offset', () => {
        const player = new MidiPlayer()
        const ctx = FakeAudioContext
        player.start() // offset = ctx.currentTime (0)
        const live = FakeAudioContext.created[0]
        live.currentTime = 3.5
        expect(player.currentTime).toBeCloseTo(3.5, 5)
        void ctx
    })

    it('start() resets the offset on a subsequent call', () => {
        const player = new MidiPlayer()
        player.start()
        const ctx = FakeAudioContext.created[0]
        ctx.currentTime = 5
        player.start() // offset now 5
        ctx.currentTime = 8
        expect(player.currentTime).toBeCloseTo(3, 5)
    })

    it('loadInstruments() loads each instrument once and dedups repeats', async () => {
        const player = new MidiPlayer()
        await player.loadInstruments([Instrument.Piano, Instrument.Piano, Instrument.Flute])
        // Piano is deduped => only two Soundfonts created.
        expect(soundfontInstances).toHaveLength(2)

        // A second call for an already-loaded instrument creates no new Soundfont.
        await player.loadInstruments([Instrument.Piano])
        expect(soundfontInstances).toHaveLength(2)

        // The Soundfont is constructed with the instrument's preset name and the GM kit.
        expect(soundfontInstances[0].opts).toMatchObject({ instrument: Instrument.Piano.presetName, kit: 'FluidR3_GM' })
    })

    it('schedule() does nothing when no context exists', () => {
        const player = new MidiPlayer()
        // No start()/loadInstruments — audioCtx is null.
        player.schedule({ startTime: 0, duration: 1, midi: 60, instrument: Instrument.Piano })
        expect(stopFns).toHaveLength(0)
    })

    it('schedule() does nothing when the instrument soundfont is not loaded', () => {
        const player = new MidiPlayer()
        player.start()
        player.schedule({ startTime: 0, duration: 1, midi: 60, instrument: Instrument.Piano })
        expect(stopFns).toHaveLength(0)
    })

    it('schedule() starts the note at startOffset + startTime when loaded', async () => {
        const player = new MidiPlayer()
        await player.loadInstruments([Instrument.Piano])
        player.start()
        const ctx = FakeAudioContext.created[0]
        ctx.currentTime = 2 // offset becomes 2 at start()? start() already ran with currentTime 0.
        // Re-seed offset deterministically.
        player.start() // offset = 2
        player.schedule({ startTime: 0.5, duration: 1, midi: 64, instrument: Instrument.Piano })
        const sf = soundfontInstances[0]
        expect(sf.start).toHaveBeenCalledWith({ note: 64, time: 2.5, duration: 1 })
        expect(stopFns).toHaveLength(1)
    })

    it('stop() cancels all scheduled notes and tolerates a throwing stop fn', async () => {
        const player = new MidiPlayer()
        await player.loadInstruments([Instrument.Piano])
        player.start()
        player.schedule({ startTime: 0, duration: 1, midi: 60, instrument: Instrument.Piano })
        const stop = stopFns[0]
        stop.mockImplementationOnce(() => {
            throw new Error('already stopped')
        })
        expect(() => player.stop()).not.toThrow()
        expect(stop).toHaveBeenCalled()

        // A second stop is a no-op (list already cleared).
        stop.mockClear()
        player.stop()
        expect(stop).not.toHaveBeenCalled()
    })

    it('pause() suspends and resume() resumes the context', () => {
        const player = new MidiPlayer()
        player.start()
        const ctx = FakeAudioContext.created[0]
        player.pause()
        expect(ctx.suspend).toHaveBeenCalled()
        player.resume()
        expect(ctx.resume).toHaveBeenCalled()
    })

    it('pause()/resume() are safe before a context exists', () => {
        const player = new MidiPlayer()
        expect(() => player.pause()).not.toThrow()
        expect(() => player.resume()).not.toThrow()
    })

    it('preview() plays a note at the live context time and replaces the previous preview', async () => {
        const player = new MidiPlayer()
        await player.loadInstruments([Instrument.Piano])
        player.start()
        const ctx = FakeAudioContext.created[0]
        ctx.currentTime = 7
        player.preview(72, 0.5, Instrument.Piano)
        const sf = soundfontInstances[0]
        expect(sf.start).toHaveBeenLastCalledWith({ note: 72, time: 7, duration: 0.5 })

        // A second preview stops the first.
        const firstStop = stopFns[stopFns.length - 1]
        player.preview(74, 0.5, Instrument.Piano)
        expect(firstStop).toHaveBeenCalled()
    })

    it('preview() resumes a suspended context before playing', async () => {
        const player = new MidiPlayer()
        await player.loadInstruments([Instrument.Piano])
        player.start()
        const ctx = FakeAudioContext.created[0]
        ctx.state = 'suspended'
        player.preview(60, 0.5, Instrument.Piano)
        expect(ctx.resume).toHaveBeenCalled()
    })

    it('preview() creates a context and returns silently when no soundfont is loaded', () => {
        const player = new MidiPlayer()
        player.preview(60, 0.5, Instrument.Piano)
        // No soundfont loaded => no note started, but a context was created.
        expect(stopFns).toHaveLength(0)
        expect(FakeAudioContext.created).toHaveLength(1)
    })

    it('stopPreview() cancels the active preview', async () => {
        const player = new MidiPlayer()
        await player.loadInstruments([Instrument.Piano])
        player.start()
        player.preview(60, 0.5, Instrument.Piano)
        const stop = stopFns[stopFns.length - 1]
        player.stopPreview()
        expect(stop).toHaveBeenCalled()
    })

    it('dispose() stops everything, disconnects soundfonts, closes and clears the context', async () => {
        const player = new MidiPlayer()
        await player.loadInstruments([Instrument.Piano])
        player.start()
        const ctx = FakeAudioContext.created[0]
        player.schedule({ startTime: 0, duration: 1, midi: 60, instrument: Instrument.Piano })
        player.preview(60, 1, Instrument.Piano)
        const sf = soundfontInstances[0]

        player.dispose()

        expect(sf.disconnect).toHaveBeenCalled()
        expect(ctx.close).toHaveBeenCalled()
        expect(player.isActive).toBe(false)
        // After dispose the soundfont map is cleared — a fresh load builds a new Soundfont.
        await player.loadInstruments([Instrument.Piano])
        expect(soundfontInstances.length).toBeGreaterThan(1)
    })

    it('dispose() is safe when nothing was ever started', () => {
        const player = new MidiPlayer()
        expect(() => player.dispose()).not.toThrow()
        expect(player.isActive).toBe(false)
    })

    it('swallows rejected resume/suspend/close promises from the audio context', async () => {
        const player = new MidiPlayer()
        player.start()
        const ctx = FakeAudioContext.created[0]
        ctx.resume.mockRejectedValueOnce(new Error('nope'))
        ctx.suspend.mockRejectedValueOnce(new Error('nope'))
        ctx.close.mockRejectedValueOnce(new Error('nope'))

        // Each call schedules a rejected promise whose .catch(() => {}) must absorb it.
        ctx.state = 'suspended'
        expect(() => player.start()).not.toThrow()
        expect(() => player.pause()).not.toThrow()
        expect(() => player.resume()).not.toThrow()
        expect(() => player.dispose()).not.toThrow()
        // Let microtasks flush so any unhandled rejection would surface.
        await Promise.resolve()
        await Promise.resolve()
    })

    it('resume() swallows a rejected resume promise', async () => {
        const player = new MidiPlayer()
        player.start()
        const ctx = FakeAudioContext.created[0]
        ctx.resume.mockRejectedValue(new Error('nope'))
        expect(() => player.resume()).not.toThrow()
        await Promise.resolve()
    })

    it('preview() swallows a rejected resume when the context is suspended', async () => {
        const player = new MidiPlayer()
        await player.loadInstruments([Instrument.Piano])
        player.start()
        const ctx = FakeAudioContext.created[0]
        ctx.state = 'suspended'
        ctx.resume.mockRejectedValueOnce(new Error('nope'))
        expect(() => player.preview(60, 0.5, Instrument.Piano)).not.toThrow()
        await Promise.resolve()
    })

    describe('audio session (iOS silent-switch handling)', () => {
        it('start() declares a playback session and stop() restores auto', () => {
            const audioSession = { type: 'auto' }
            vi.stubGlobal('navigator', { audioSession })
            const player = new MidiPlayer()
            player.start()
            expect(audioSession.type).toBe('playback')
            player.stop()
            expect(audioSession.type).toBe('auto')
        })

        it('preview() and resume() declare a playback session', () => {
            const audioSession = { type: 'auto' }
            vi.stubGlobal('navigator', { audioSession })
            const player = new MidiPlayer()
            player.preview(60, 0.5, Instrument.Piano)
            expect(audioSession.type).toBe('playback')

            audioSession.type = 'auto'
            player.resume()
            expect(audioSession.type).toBe('playback')
        })

        it('dispose() restores the session to auto', () => {
            const audioSession = { type: 'auto' }
            vi.stubGlobal('navigator', { audioSession })
            const player = new MidiPlayer()
            player.start()
            player.dispose()
            expect(audioSession.type).toBe('auto')
        })

        it("never touches a session the RecordingEngine owns ('play-and-record')", () => {
            const audioSession = { type: 'play-and-record' }
            vi.stubGlobal('navigator', { audioSession })
            const player = new MidiPlayer()
            player.start() // count-off playback during a take
            expect(audioSession.type).toBe('play-and-record')
            player.stop()
            expect(audioSession.type).toBe('play-and-record')
        })

        it('is a no-op on browsers without the audioSession API', () => {
            vi.stubGlobal('navigator', {})
            const player = new MidiPlayer()
            expect(() => {
                player.start()
                player.stop()
            }).not.toThrow()
        })
    })
})
