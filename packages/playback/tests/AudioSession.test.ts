import { AudioSession } from '@mushee/playback/AudioSession'
import { afterEach, describe, expect, it, vi } from 'vitest'

describe('AudioSession', () => {
    afterEach(() => {
        vi.unstubAllGlobals()
    })

    /** A WebKit-style session starting in `type`, installed on the stubbed navigator. */
    function stubSession(type: string) {
        const audioSession = { type }
        vi.stubGlobal('navigator', { audioSession })
        return audioSession
    }

    it("a playback claim declares 'playback' and its release restores 'auto'", () => {
        const session = stubSession('auto')
        AudioSession.claim('playback')
        expect(session.type).toBe('playback')
        AudioSession.release('playback')
        expect(session.type).toBe('auto')
    })

    it("a record claim declares 'play-and-record' over a playback session and its release restores 'auto'", () => {
        // A note preview leaves the session in 'playback'; the mic must still get its category.
        const session = stubSession('playback')
        AudioSession.claim('record')
        expect(session.type).toBe('play-and-record')
        AudioSession.release('record')
        expect(session.type).toBe('auto')
    })

    it("playback never touches a 'play-and-record' session", () => {
        const session = stubSession('play-and-record')
        AudioSession.claim('playback') // count-off playback during a take
        expect(session.type).toBe('play-and-record')
        AudioSession.release('playback')
        expect(session.type).toBe('play-and-record')
    })

    it('reads the live session type, not a claim count', () => {
        // Whoever declared play-and-record, a later playback claim leaves it alone;
        // once the session is back to 'auto', playback claims again.
        const session = stubSession('auto')
        AudioSession.claim('playback')
        session.type = 'play-and-record'
        AudioSession.claim('playback')
        expect(session.type).toBe('play-and-record')
        session.type = 'auto'
        AudioSession.claim('playback')
        expect(session.type).toBe('playback')
    })

    it('is a no-op on browsers without the audioSession API', () => {
        vi.stubGlobal('navigator', {})
        expect(() => {
            AudioSession.claim('playback')
            AudioSession.release('playback')
            AudioSession.claim('record')
            AudioSession.release('record')
        }).not.toThrow()
    })

    it('is a no-op without a navigator (server rendering)', () => {
        vi.stubGlobal('navigator', undefined)
        expect(() => {
            AudioSession.claim('record')
            AudioSession.release('record')
        }).not.toThrow()
    })
})
