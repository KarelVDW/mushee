/** WebKit's Audio Session API (Safari 16.4+); absent everywhere else. */
type NavigatorWithAudioSession = Navigator & { audioSession?: { type: string } }

type AudioSessionKind = 'playback' | 'record'

/**
 * The page's claim on the OS audio session, through WebKit's Audio Session
 * API; every call is a no-op on browsers without it.
 *
 * - 'playback' declares a playback session. iOS mutes Web Audio while the
 *   hardware silent switch is on unless the session is declared 'playback' —
 *   without it, replay and note previews are inaudible for anyone whose phone
 *   is on silent.
 * - 'record' declares 'play-and-record' before the mic opens. When a page
 *   starts capturing, iOS otherwise yanks the session from 'playback' to
 *   play-and-record mid-flight, which can reroute output to the receiver
 *   (earpiece) at a fraction of the volume — WebKit bug 218012. WebKit also
 *   refuses getUserMedia outright (InvalidStateError) while the session sits
 *   in a playback-only category, which a note preview leaves behind.
 *
 * Recording takes precedence: a playback claim or release never touches a
 * 'play-and-record' session, so count-off playback during a take cannot break
 * mic capture. The rule reads the live session type rather than counting
 * claims, so it holds no matter who declared the session.
 */
export class AudioSession {
    static claim(kind: AudioSessionKind): void {
        AudioSession.declare(kind, kind === 'record' ? 'play-and-record' : 'playback')
    }

    /** Hand the session back to the OS default. */
    static release(kind: AudioSessionKind): void {
        AudioSession.declare(kind, 'auto')
    }

    private static declare(kind: AudioSessionKind, type: string): void {
        if (typeof navigator === 'undefined') return
        const session = (navigator as NavigatorWithAudioSession).audioSession
        if (!session) return
        if (kind === 'playback' && session.type === 'play-and-record') return
        session.type = type
    }
}
