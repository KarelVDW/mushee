import type { MxmlMeasure } from '@mushee/notation/model/io/MusicXml'

/**
 * Cap on chunks held while the socket finishes connecting. At the recorder's
 * 100 ms chunks this is a few seconds of audio — far more than a handshake
 * needs, and bounded so a socket that never opens cannot grow the queue
 * without limit.
 */
const MAX_PENDING_CHUNKS = 100
/**
 * How long after sending `end` the socket may stay open waiting for the
 * server's final transcription pass (`score-update`s + `recording-complete`).
 * The server closes as soon as it has flushed; this is only the safety net
 * against a server that never answers.
 */
const DRAIN_TIMEOUT_MS = 10_000

/** Sent by the gateway when the daily recording budget runs out (or already had). */
export interface RecordingLimitInfo {
    planId: string
    planName: string
    /** Daily budget in seconds; `null` on unlimited tiers (never sent in practice). */
    limitSeconds: number | null
    usedSeconds: number
}

/** Reasons the gateway refuses a recording connection. */
export type RecordingErrorCode = 'score-required' | 'score-not-found' | 'concurrent-recording' | 'beta-pending'

/** The take's `meta` frame, sent once before any audio. */
export interface TranscriptionMeta {
    bpm: number
    timeSignature: { beats: number; beatType: number }
    chromaticTranspose: number
    instrumentId: string
    keyFifths: number
    /** `null` = the browser's default container; the server probes it. */
    mimeType: string | null
}

/** Where the server's messages go. Unknown message types are ignored. */
export interface TranscriptionHandlers {
    onScoreUpdate?: (update: { measures: Record<number, MxmlMeasure> }) => void
    onLimitReached: (info: RecordingLimitInfo) => void
    onRecordingError: (code: RecordingErrorCode) => void
    onHealth: (health: { ok: boolean }) => void
    /** The connection died while the take still counted on it. */
    onConnectionLost: () => void
}

/**
 * One take's WebSocket to the transcription gateway: the `meta` frame, the
 * encoded audio (queued while the handshake is still in flight, so a slow
 * network delays delivery, never capture), the server's messages, and the
 * closing drain that lets the take's last notes come back after stop.
 */
export class TranscriptionSocket {
    private readonly ws: WebSocket
    /** Settles on the socket's first `open` or `error` event; see handshake(). */
    private readonly settled: Promise<void>
    /** Encoded chunks captured before the socket finished connecting, flushed behind the meta frame. */
    private pendingChunks: Blob[] = []
    /** True once the `meta` frame has gone out, so it is sent exactly once. */
    private metaSent = false
    /** The take still counts on this socket: not retired, and the handshake hasn't failed nor the connection dropped. */
    private current = true

    /** Opens the connection; throws when the WebSocket constructor does (e.g. a refused URL). */
    constructor(
        url: string,
        private readonly handlers: TranscriptionHandlers,
    ) {
        this.ws = new WebSocket(url)
        // Listened for from construction, so a handshake() call made after the
        // socket already opened (or failed) still settles.
        this.settled = new Promise<void>((resolve) => {
            this.ws.addEventListener('open', () => resolve(), { once: true })
            this.ws.addEventListener('error', () => resolve(), { once: true })
        })
        // A close while the take still counts on this socket means the connection
        // died under the user — surface it instead of letting them keep singing
        // into a dead socket.
        this.ws.addEventListener('close', () => {
            if (!this.current) return
            this.current = false
            this.handlers.onConnectionLost()
        })
        this.ws.addEventListener('message', (event) => this.dispatch(event))
    }

    /** Settles once the handshake does, opened or failed — {@link isOpen} tells which. Any number of calls, at any time, share it. */
    handshake(): Promise<void> {
        return this.settled
    }

    get isOpen(): boolean {
        return this.ws.readyState === WebSocket.OPEN
    }

    /** The handshake failed (and was reported by whoever awaited it): nothing more queues. */
    markFailed(): void {
        this.current = false
    }

    /**
     * Send the take's `meta` frame, then any audio queued while connecting, in
     * order. Idempotent; a no-op until the socket is open.
     */
    sendMeta(meta: TranscriptionMeta): void {
        if (this.metaSent || !this.isOpen) return
        this.ws.send(JSON.stringify({ type: 'meta', ...meta }))
        this.metaSent = true
        this.flushPendingChunks()
    }

    /**
     * Deliver one encoded chunk: straight away once open, queued (bounded) while
     * the socket is still handshaking for a take that counts on it, dropped
     * otherwise.
     */
    send(chunk: Blob): void {
        if (this.isOpen) {
            this.flushPendingChunks()
            this.ws.send(chunk)
        } else if (this.current && this.pendingChunks.length < MAX_PENDING_CHUNKS) {
            this.pendingChunks.push(chunk)
        }
    }

    /**
     * The take is over: anything still queued is dropped, nothing more is
     * queued, and a close no longer reports a lost connection. Audio sent while
     * the socket stays open (the recorder's final flush) still goes out.
     */
    retire(): void {
        this.current = false
        this.pendingChunks = []
    }

    /**
     * Ask the server to finish the take. The socket then stays open: the server
     * is still transcribing the take's tail and streams those last notes back
     * as `score-update`s before answering `recording-complete` and closing —
     * closing here would drop the notes from the final moments of every take.
     * A socket that isn't open (or can't send) is just closed.
     *
     * `onClosed` runs once the socket is done with the take — right away when
     * it was just closed, otherwise on the close that follows the server's
     * `recording-complete`, a server-side close, or the drain timeout.
     */
    end(onClosed: () => void = () => {}): void {
        if (!this.isOpen) {
            this.ws.close()
            onClosed()
            return
        }
        try {
            this.ws.send(JSON.stringify({ type: 'end' }))
        } catch {
            this.ws.close()
            onClosed()
            return
        }
        let closed = false
        const done = () => {
            if (closed) return
            closed = true
            clearTimeout(fallback)
            onClosed()
        }
        // The timeout reports the drain itself: a close the server never answers
        // may not raise its close event for a while.
        const fallback = setTimeout(() => {
            this.ws.close()
            done()
        }, DRAIN_TIMEOUT_MS)
        this.ws.addEventListener('close', done, { once: true })
    }

    close(): void {
        this.ws.close()
    }

    private flushPendingChunks(): void {
        for (const chunk of this.pendingChunks) this.ws.send(chunk)
        this.pendingChunks = []
    }

    private dispatch(event: MessageEvent): void {
        if (typeof event.data !== 'string') return
        let msg: unknown
        try {
            msg = JSON.parse(event.data)
        } catch {
            return
        }
        if (!msg || typeof msg !== 'object') return
        const payload = msg as {
            type?: string
            measures?: Record<number, MxmlMeasure>
            code?: RecordingErrorCode
            planId?: string
            planName?: string
            limitSeconds?: number | null
            usedSeconds?: number
            ok?: boolean
        }
        if (payload.type === 'score-update' && payload.measures) {
            this.handlers.onScoreUpdate?.({ measures: payload.measures })
        } else if (payload.type === 'recording-complete') {
            // The server has flushed everything for this take; it closes right
            // after, but close from our side too so the post-stop drain doesn't
            // depend on it.
            this.ws.close()
        } else if (payload.type === 'recording-limit') {
            this.handlers.onLimitReached({
                planId: payload.planId ?? 'free',
                planName: payload.planName ?? '',
                limitSeconds: payload.limitSeconds ?? null,
                usedSeconds: payload.usedSeconds ?? 0,
            })
        } else if (payload.type === 'recording-error' && payload.code) {
            this.handlers.onRecordingError(payload.code)
        } else if (payload.type === 'recording-health' && typeof payload.ok === 'boolean') {
            this.handlers.onHealth({ ok: payload.ok })
        }
    }
}
