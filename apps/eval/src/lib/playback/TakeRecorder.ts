/**
 * Mic capture for eval takes: getUserMedia with the browser's voice
 * processing OFF (echo cancellation / noise suppression / AGC eat pure tones —
 * same constraints the product's RecordingEngine uses), MediaRecorder with the
 * product's container preference order, buffered locally into one Blob.
 *
 * Unlike the product there is no WebSocket: a take is uploaded whole when it
 * ends, and the count-in is trimmed server-side via the timestamps this class
 * records.
 */

const MIME_PREFERENCE = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4']

export interface FinishedTake {
    blob: Blob
    mimeType: string
    /** performance.now() when capture actually began (MediaRecorder onstart). */
    captureStartMs: number
}

export class TakeRecorder {
    private stream: MediaStream | null = null
    private recorder: MediaRecorder | null = null
    private chunks: Blob[] = []
    private captureStartMs = 0

    get isActive(): boolean {
        return this.recorder !== null
    }

    /** Acquire the mic and begin capturing. Resolves once frames are flowing. */
    async start(): Promise<void> {
        if (this.recorder) throw new Error('already recording')
        this.stream = await navigator.mediaDevices.getUserMedia({
            audio: {
                echoCancellation: false,
                noiseSuppression: false,
                autoGainControl: false,
            },
        })
        const mimeType = MIME_PREFERENCE.find((m) => MediaRecorder.isTypeSupported(m))
        const recorder = new MediaRecorder(this.stream, mimeType ? { mimeType } : undefined)
        this.recorder = recorder
        this.chunks = []
        recorder.ondataavailable = (event) => {
            if (event.data.size > 0) this.chunks.push(event.data)
        }
        await new Promise<void>((resolve, reject) => {
            recorder.onstart = () => {
                this.captureStartMs = performance.now()
                resolve()
            }
            recorder.onerror = () => reject(new Error('MediaRecorder failed to start'))
            recorder.start(100)
        })
    }

    /** End the take and hand back the whole capture. */
    async stop(): Promise<FinishedTake> {
        const recorder = this.recorder
        if (!recorder) throw new Error('not recording')
        const captureStartMs = this.captureStartMs
        const blob = await new Promise<Blob>((resolve) => {
            recorder.onstop = () => resolve(new Blob(this.chunks, { type: recorder.mimeType }))
            recorder.stop()
        })
        this.release()
        return { blob, mimeType: recorder.mimeType, captureStartMs }
    }

    /** Abandon the take (nothing is kept). Idempotent. */
    cancel(): void {
        if (this.recorder && this.recorder.state !== 'inactive') this.recorder.stop()
        this.release()
    }

    private release(): void {
        this.stream?.getTracks().forEach((track) => track.stop())
        this.stream = null
        this.recorder = null
        this.chunks = []
    }
}
