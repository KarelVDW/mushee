import { AudioSession } from '@mushee/playback/AudioSession'

/**
 * Thrown by {@link Microphone.open} when the browser cannot capture audio at
 * all — no `mediaDevices` (ancient browser) or an insecure (non-HTTPS)
 * context, where the API is hidden. Distinct from a permission denial, which
 * surfaces as a `NotAllowedError` DOMException from `getUserMedia` itself.
 */
export class RecordingUnsupportedError extends Error {
    constructor() {
        super('Audio capture is not available in this browser or context')
        this.name = 'RecordingUnsupportedError'
    }
}

/**
 * The page's microphone. Every stream opens under the 'record'
 * {@link AudioSession} claim, declared before `getUserMedia` so iOS picks the
 * play-and-record route up front (and doesn't refuse capture from the
 * playback-only session a note preview leaves behind); the claim is handed
 * back whenever capture fails or ends.
 */
export class Microphone {
    /** Declare the record session and open a stream; the session is restored if the mic is refused. */
    static async open(constraints: MediaStreamConstraints): Promise<MediaStream> {
        if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
            throw new RecordingUnsupportedError()
        }
        AudioSession.claim('record')
        try {
            return await navigator.mediaDevices.getUserMedia(constraints)
        } catch (err) {
            AudioSession.release('record')
            throw err
        }
    }

    /** Hand the audio session back to the OS default; any stream's tracks are left alone. */
    static endSession(): void {
        AudioSession.release('record')
    }

    /** Stop the stream's tracks (turning the mic indicator off); the session is left alone. */
    static stopTracks(stream: MediaStream): void {
        stream.getTracks().forEach((t) => t.stop())
    }

    /** Done with `stream` entirely: stop its tracks and end the session. */
    static release(stream: MediaStream): void {
        Microphone.stopTracks(stream)
        Microphone.endSession()
    }
}
