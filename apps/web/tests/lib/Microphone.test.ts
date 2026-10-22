import { afterEach, describe, expect, it, vi } from 'vitest'

import { Microphone, RecordingUnsupportedError } from '@/lib/Microphone'

function fakeStream() {
    const track = { stop: vi.fn() }
    return { getTracks: () => [track], track } as unknown as MediaStream & { track: { stop: ReturnType<typeof vi.fn> } }
}

/** A WebKit-style navigator: an audio session plus a getUserMedia that records the session type it was prompted under. */
function stubNavigator(getUserMedia: () => Promise<unknown>) {
    const audioSession = { type: 'auto' }
    const prompts: string[] = []
    vi.stubGlobal('navigator', {
        audioSession,
        mediaDevices: {
            getUserMedia: vi.fn(() => {
                prompts.push(audioSession.type)
                return getUserMedia()
            }),
        },
    })
    return { audioSession, prompts }
}

describe('Microphone', () => {
    afterEach(() => {
        vi.unstubAllGlobals()
    })

    it('declares play-and-record before the prompt and keeps it while the stream is open', async () => {
        const stream = fakeStream()
        const { audioSession, prompts } = stubNavigator(() => Promise.resolve(stream))

        await expect(Microphone.open({ audio: true })).resolves.toBe(stream)
        expect(prompts).toEqual(['play-and-record'])
        expect(audioSession.type).toBe('play-and-record')
    })

    it('restores the audio session when the mic is refused', async () => {
        const denied = new DOMException('denied', 'NotAllowedError')
        const { audioSession } = stubNavigator(() => Promise.reject(denied))

        await expect(Microphone.open({ audio: true })).rejects.toBe(denied)
        expect(audioSession.type).toBe('auto')
    })

    it('throws RecordingUnsupportedError without mediaDevices or without a navigator', async () => {
        vi.stubGlobal('navigator', {})
        await expect(Microphone.open({ audio: true })).rejects.toBeInstanceOf(RecordingUnsupportedError)

        vi.stubGlobal('navigator', undefined)
        await expect(Microphone.open({ audio: true })).rejects.toBeInstanceOf(RecordingUnsupportedError)
    })

    it('release() stops the tracks and hands the session back', async () => {
        const stream = fakeStream()
        const { audioSession } = stubNavigator(() => Promise.resolve(stream))
        await Microphone.open({ audio: true })

        Microphone.release(stream)
        expect(stream.track.stop).toHaveBeenCalled()
        expect(audioSession.type).toBe('auto')
    })

    it('stopTracks() and endSession() each do only their half', async () => {
        const stream = fakeStream()
        const { audioSession } = stubNavigator(() => Promise.resolve(stream))
        await Microphone.open({ audio: true })

        Microphone.stopTracks(stream)
        expect(stream.track.stop).toHaveBeenCalled()
        expect(audioSession.type).toBe('play-and-record')

        Microphone.endSession()
        expect(audioSession.type).toBe('auto')
    })
})
