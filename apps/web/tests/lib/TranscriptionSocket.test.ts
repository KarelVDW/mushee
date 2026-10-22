import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { TranscriptionSocket, type TranscriptionMeta } from '@/lib/TranscriptionSocket'

let lastSocket: FakeWebSocket | null = null
const rememberSocket = (socket: FakeWebSocket): void => {
    lastSocket = socket
}
class FakeWebSocket {
    static OPEN = 1
    static CLOSED = 3
    readyState = 0
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

function ws(): FakeWebSocket {
    if (!lastSocket) throw new Error('expected a websocket to have been created')
    return lastSocket
}

const META: TranscriptionMeta = {
    bpm: 90,
    timeSignature: { beats: 4, beatType: 4 },
    chromaticTranspose: 0,
    instrumentId: 'piano',
    keyFifths: 0,
    mimeType: null,
}

function handlers() {
    return {
        onScoreUpdate: vi.fn(),
        onLimitReached: vi.fn(),
        onRecordingError: vi.fn(),
        onHealth: vi.fn(),
        onConnectionLost: vi.fn(),
    }
}

const chunk = (size: number) => ({ size }) as unknown as Blob

describe('TranscriptionSocket', () => {
    beforeEach(() => {
        lastSocket = null
        vi.stubGlobal('WebSocket', FakeWebSocket)
    })

    afterEach(() => {
        vi.unstubAllGlobals()
        vi.useRealTimers()
    })

    it('handshake() settles on open or on error, and isOpen tells which', async () => {
        const opened = new TranscriptionSocket('ws://x', handlers())
        const settled = opened.handshake()
        ws().readyState = FakeWebSocket.OPEN
        ws().fire('open')
        await settled
        expect(opened.isOpen).toBe(true)

        const failed = new TranscriptionSocket('ws://x', handlers())
        const settledFailed = failed.handshake()
        ws().readyState = FakeWebSocket.CLOSED
        ws().fire('error')
        await settledFailed
        expect(failed.isOpen).toBe(false)
    })

    it('queues audio while handshaking and sends it behind the meta frame once open', () => {
        const socket = new TranscriptionSocket('ws://x', handlers())
        socket.send(chunk(1))
        socket.send(chunk(2))
        // Not open yet: meta waits too.
        socket.sendMeta(META)
        expect(ws().sent).toHaveLength(0)

        ws().readyState = FakeWebSocket.OPEN
        socket.sendMeta(META)
        socket.sendMeta(META) // idempotent
        expect(JSON.parse(ws().sent[0] as string)).toEqual({ type: 'meta', ...META })
        expect(ws().sent.slice(1)).toEqual([chunk(1), chunk(2)])

        socket.send(chunk(3))
        expect(ws().sent).toHaveLength(4)
    })

    it('bounds the handshake queue so a socket that never opens cannot grow without limit', () => {
        const socket = new TranscriptionSocket('ws://x', handlers())
        for (let i = 0; i < 150; i++) socket.send(chunk(i))
        ws().readyState = FakeWebSocket.OPEN
        socket.sendMeta(META)
        // The meta frame plus the first 100 chunks.
        expect(ws().sent).toHaveLength(101)
    })

    it('stops queueing once retired or once the handshake failed', () => {
        const retired = new TranscriptionSocket('ws://x', handlers())
        retired.send(chunk(1))
        retired.retire()
        retired.send(chunk(2))
        ws().readyState = FakeWebSocket.OPEN
        retired.sendMeta(META)
        expect(ws().sent).toHaveLength(1) // only the meta frame: the queue was dropped

        const failed = new TranscriptionSocket('ws://x', handlers())
        failed.markFailed()
        failed.send(chunk(1))
        ws().readyState = FakeWebSocket.OPEN
        failed.sendMeta(META)
        expect(ws().sent).toHaveLength(1)
    })

    it('still sends straight through an open socket after retire (the recorder’s final flush)', () => {
        const socket = new TranscriptionSocket('ws://x', handlers())
        ws().readyState = FakeWebSocket.OPEN
        socket.retire()
        socket.send(chunk(7))
        expect(ws().sent).toEqual([chunk(7)])
    })

    it('reports a close as a lost connection only while the take counts on it', () => {
        const h = handlers()
        new TranscriptionSocket('ws://x', h)
        ws().fire('close')
        ws().fire('close')
        expect(h.onConnectionLost).toHaveBeenCalledTimes(1)

        const quiet = handlers()
        const retired = new TranscriptionSocket('ws://x', quiet)
        retired.retire()
        ws().fire('close')
        expect(quiet.onConnectionLost).not.toHaveBeenCalled()
    })

    it('dispatches the server messages and ignores anything else', () => {
        const h = handlers()
        new TranscriptionSocket('ws://x', h)
        const message = (data: unknown) => ws().fire('message', { data: typeof data === 'string' ? data : JSON.stringify(data) })

        message({ type: 'score-update', measures: { 0: { m: 1 } } })
        message({ type: 'recording-limit', planId: 'free', planName: 'Sketch', limitSeconds: 30, usedSeconds: 30 })
        message({ type: 'recording-limit' })
        message({ type: 'recording-error', code: 'concurrent-recording' })
        message({ type: 'recording-health', ok: false })
        // Ignored: malformed, codeless, stateless, measure-less and unknown types.
        ws().fire('message', { data: 42 })
        message('not json{')
        message(null)
        message({ type: 'score-update' })
        message({ type: 'recording-error' })
        message({ type: 'recording-health' })
        message({ type: 'recording-source', source: 'voice', decidedBy: 'classifier' })

        expect(h.onScoreUpdate.mock.calls).toEqual([[{ measures: { 0: { m: 1 } } }]])
        expect(h.onLimitReached.mock.calls).toEqual([
            [{ planId: 'free', planName: 'Sketch', limitSeconds: 30, usedSeconds: 30 }],
            [{ planId: 'free', planName: '', limitSeconds: null, usedSeconds: 0 }],
        ])
        expect(h.onRecordingError.mock.calls).toEqual([['concurrent-recording']])
        expect(h.onHealth.mock.calls).toEqual([[{ ok: false }]])
    })

    it('closes itself on recording-complete', () => {
        new TranscriptionSocket('ws://x', handlers())
        ws().fire('message', { data: JSON.stringify({ type: 'recording-complete' }) })
        expect(ws().close).toHaveBeenCalled()
    })

    it('end() sends `end` and stays open to drain, closing itself after the timeout', () => {
        vi.useFakeTimers()
        const socket = new TranscriptionSocket('ws://x', handlers())
        ws().readyState = FakeWebSocket.OPEN
        socket.end()
        expect(ws().sent).toEqual([JSON.stringify({ type: 'end' })])
        expect(ws().close).not.toHaveBeenCalled()
        vi.advanceTimersByTime(10_000)
        expect(ws().close).toHaveBeenCalled()
    })

    it('end() lets a server close cancel the drain timeout', () => {
        vi.useFakeTimers()
        const socket = new TranscriptionSocket('ws://x', handlers())
        ws().readyState = FakeWebSocket.OPEN
        socket.end()
        ws().fire('close')
        vi.advanceTimersByTime(10_000)
        expect(ws().close).not.toHaveBeenCalled()
    })

    it('end() just closes a socket that is not open or cannot send', () => {
        const connecting = new TranscriptionSocket('ws://x', handlers())
        connecting.end()
        expect(ws().sent).toHaveLength(0)
        expect(ws().close).toHaveBeenCalled()

        const broken = new TranscriptionSocket('ws://x', handlers())
        ws().readyState = FakeWebSocket.OPEN
        ws().send = vi.fn(() => {
            throw new Error('socket closing')
        })
        broken.end()
        expect(ws().close).toHaveBeenCalled()
    })
})
