import 'reflect-metadata'

import { EventEmitter } from 'node:events'
import type { IncomingMessage } from 'node:http'

import { ForbiddenException, Logger, NotFoundException } from '@nestjs/common'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { WebSocket } from 'ws'

import type { BetaService } from '../../src/beta/beta.service'
import type { RecordingSessionsService } from '../../src/recordings/recording-sessions.service'
import { RecordingsGateway } from '../../src/recordings/recordings.gateway'
import type { ScoresService } from '../../src/scores/scores.service'

const getSession = vi.fn(() => Promise.resolve({ user: { id: 'u1' } }))

// auth.config builds a pg Pool at import; the injected services pull in TypeORM
// entities and TF.js. The gateway only needs their behaviour, faked below.
vi.mock('../../src/auth/auth.config', () => ({
    auth: {
        api: {
            get getSession() {
                return getSession
            },
        },
    },
}))
vi.mock('../../src/scores/scores.service', () => ({ ScoresService: class ScoresService {} }))
vi.mock('../../src/beta/beta.service', () => ({ BetaService: class BetaService {} }))
vi.mock('../../src/recordings/recording-sessions.service', () => ({
    RecordingSessionsService: class RecordingSessionsService {},
}))

/**
 * The recording socket's message path. Text frames come from the client
 * unchecked: none may throw out of the ws listener (that kills the process),
 * and only a well-typed meta frame may reach the pipeline.
 */

const SCORE_ID = '3f2b8c1e-9a4d-4e6f-8b2a-1c5d7e9f0a3b'

/**
 * The web client's side of the meta contract — `TranscriptionMeta` in
 * apps/web/src/lib/TranscriptionSocket.ts, which `sendMeta` spreads into a
 * `{ type: 'meta', ... }` frame — with the values RecordingEngine.start fills
 * in: the tempo at the take's start, its bar's meter and key, the instrument's
 * written→sounding transposition, and the negotiated MediaRecorder container.
 * Keep the two in step: a field the DTO rejects is dropped server-side.
 */
interface WebMetaFrame {
    type: 'meta'
    bpm: number
    timeSignature: { beats: number; beatType: number }
    chromaticTranspose: number
    instrumentId: string
    keyFifths: number
    mimeType: string | null
}
const webMetaFrame: WebMetaFrame = {
    type: 'meta',
    bpm: 92.5,
    timeSignature: { beats: 6, beatType: 8 },
    chromaticTranspose: -2,
    instrumentId: 'trumpet',
    keyFifths: -3,
    mimeType: 'audio/webm;codecs=opus',
}

class FakeSocket extends EventEmitter {
    readonly OPEN = 1
    readyState = 1
    readonly sent: unknown[] = []
    send = vi.fn((data: string) => this.sent.push(JSON.parse(data)))
    close = vi.fn(() => {
        this.readyState = 2
    })
    ping = vi.fn()
    terminate = vi.fn()
}

const sockets: FakeSocket[] = []
afterEach(() => {
    // Ends each connection's keepalive interval.
    for (const socket of sockets.splice(0)) socket.emit('close')
})

const flush = () => new Promise((resolve) => setImmediate(resolve))

function connect({
    scoreId = SCORE_ID,
    findOne = () => Promise.resolve({}),
    opened,
}: { scoreId?: string; findOne?: () => Promise<unknown>; opened?: unknown } = {}) {
    const session = {
        setMeta: vi.fn(),
        appendChunk: vi.fn(),
        close: vi.fn(() => Promise.resolve()),
    }
    const recordingSessions = {
        open: vi.fn((_userId: string, _scoreId: string, _events: unknown) => Promise.resolve(opened ?? { session })),
    }
    const scores = { findOne: vi.fn(findOne) }
    const gateway = new RecordingsGateway(
        recordingSessions as unknown as RecordingSessionsService,
        scores as unknown as ScoresService,
        { isAwaitingApproval: vi.fn(() => Promise.resolve(false)) } as unknown as BetaService,
    )
    const client = new FakeSocket()
    sockets.push(client)
    gateway.handleConnection(client as unknown as WebSocket, { url: `/recording?scoreId=${scoreId}`, headers: {} } as IncomingMessage)
    const text = (frame: string) => client.emit('message', Buffer.from(frame), false)
    return { client, session, text, scores, recordingSessions }
}

describe('RecordingsGateway score check', () => {
    it('refuses a malformed score id as not found, without querying the uuid column', async () => {
        const { client, scores, recordingSessions } = connect({ scoreId: 'not-a-uuid' })
        await flush()
        expect(scores.findOne).not.toHaveBeenCalled()
        expect(recordingSessions.open).not.toHaveBeenCalled()
        expect(client.sent).toEqual([{ type: 'recording-error', code: 'score-not-found' }])
        expect(client.close).toHaveBeenCalledWith(1008, 'score-not-found')
    })

    it('refuses an unknown or someone else’s score as not found', async () => {
        for (const error of [new NotFoundException(), new ForbiddenException()]) {
            const { client } = connect({ findOne: () => Promise.reject(error) })
            await flush()
            expect(client.sent).toEqual([{ type: 'recording-error', code: 'score-not-found' }])
        }
    })

    it('reports a failing score lookup as a server failure, not a missing score', async () => {
        const { client, recordingSessions } = connect({ findOne: () => Promise.reject(new Error('connection terminated')) })
        await flush()
        expect(recordingSessions.open).not.toHaveBeenCalled()
        expect(client.sent).toEqual([])
        expect(client.close).toHaveBeenCalledWith(1011, 'Recording session failed')
    })
})

describe('RecordingsGateway recording-limit frame', () => {
    const balance = {
        tier: { id: 'free', name: 'Sketch', dailyRecordingCredits: 180 },
        used: 180,
        remaining: 0,
        packSeconds: 0,
        exhausted: true,
        resetsAt: '2026-10-23T00:00:00.000Z',
    }
    const frame = {
        type: 'recording-limit',
        planId: 'free',
        planName: 'Sketch',
        limitSeconds: 180,
        usedSeconds: 180,
        resetsAt: '2026-10-23T00:00:00.000Z',
    }

    it('tells a client with no budget left when it refills, then closes', async () => {
        const { client } = connect({ opened: { rejected: 'limit-reached', balance } })
        await flush()
        expect(client.sent).toEqual([frame])
        expect(client.close).toHaveBeenCalledWith(1008, 'Daily recording limit reached')
    })

    it('sends the same frame when the budget runs out mid-recording', async () => {
        const { client, recordingSessions } = connect()
        await flush()
        const events = recordingSessions.open.mock.calls[0][2] as { onLimitReached: (b: typeof balance) => void }
        events.onLimitReached(balance)
        expect(client.sent).toEqual([frame])
    })
})

describe('RecordingsGateway text frames', () => {
    it('ignores frames that are not a control object, without throwing or closing', async () => {
        const { client, session, text } = connect()
        await flush()
        for (const frame of ['null', '[]', '42', '"meta"', 'not json', '{"type":"ping"}']) {
            expect(() => text(frame)).not.toThrow()
        }
        expect(session.setMeta).not.toHaveBeenCalled()
        expect(client.close).not.toHaveBeenCalled()
    })

    it('never forwards a mistyped meta field', async () => {
        const { client, session, text } = connect()
        await flush()
        expect(() => text('{"type":"meta","bpm":"fast"}')).not.toThrow()
        text('{"type":"meta","timeSignature":{"beats":0,"beatType":4}}')
        text('{"type":"meta","timeSignature":5}')
        text('{"type":"meta","sourceKind":"kazoo"}')
        text(`{"type":"meta","mimeType":"${'x'.repeat(500)}"}`)
        for (const [meta] of session.setMeta.mock.calls as [Record<string, unknown>][]) expect({ ...meta }).toEqual({})
        expect(client.close).not.toHaveBeenCalled()
    })

    it('drops only the invalid fields of a meta frame, and logs their names but not their values', async () => {
        const { session, text } = connect()
        await flush()
        const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)
        // e.g. a future additive meter the DTO does not accept yet: the rest of the take's meta must survive it.
        text(JSON.stringify({ ...webMetaFrame, bpm: -1, timeSignature: { beats: 2.5, beatType: 8 } }))
        expect(session.setMeta).toHaveBeenCalledTimes(1)
        const meta = (session.setMeta.mock.calls[0] as unknown[])[0] as Record<string, unknown>
        expect({ ...meta }).toEqual({
            chromaticTranspose: webMetaFrame.chromaticTranspose,
            instrumentId: webMetaFrame.instrumentId,
            keyFifths: webMetaFrame.keyFifths,
            mimeType: webMetaFrame.mimeType,
        })
        expect(warn).toHaveBeenCalledWith('Dropped invalid recording meta fields: bpm, timeSignature.beats')
        warn.mockRestore()
    })

    it('forwards every field of the meta frame the web client sends', async () => {
        const { session, text } = connect()
        await flush()
        for (const mimeType of ['audio/webm;codecs=opus', 'audio/mp4', null]) {
            session.setMeta.mockClear()
            text(JSON.stringify({ ...webMetaFrame, mimeType }))
            expect(session.setMeta).toHaveBeenCalledTimes(1)
            const meta = (session.setMeta.mock.calls[0] as unknown[])[0] as Record<string, unknown>
            const { type: _type, ...fields } = { ...webMetaFrame, mimeType }
            expect(JSON.parse(JSON.stringify(meta))).toEqual(fields)
        }
    })

    it('forwards a valid meta frame, minus unknown keys', async () => {
        const { session, text } = connect()
        await flush()
        text(
            JSON.stringify({
                type: 'meta',
                bpm: 96,
                timeSignature: { beats: 6, beatType: 8 },
                chromaticTranspose: -2,
                instrumentId: 'trumpet',
                keyFifths: 2,
                mimeType: null,
                debug: 'not part of the protocol',
            }),
        )
        expect(session.setMeta).toHaveBeenCalledTimes(1)
        const meta = (session.setMeta.mock.calls[0] as unknown[])[0] as Record<string, unknown>
        expect({ ...meta }).toEqual({
            bpm: 96,
            timeSignature: expect.objectContaining({ beats: 6, beatType: 8 }) as unknown,
            chromaticTranspose: -2,
            instrumentId: 'trumpet',
            keyFifths: 2,
            mimeType: null,
        })
        expect(meta).not.toHaveProperty('debug')
    })

    it('validates frames buffered before the session opened, then replays them', async () => {
        const { session, text } = connect()
        text('null')
        text('{"type":"meta","bpm":120}')
        await flush()
        expect(session.setMeta).toHaveBeenCalledTimes(1)
        expect(session.setMeta).toHaveBeenCalledWith(expect.objectContaining({ bpm: 120 }))
    })

    it('closes the socket instead of letting a handler error escape into ws', async () => {
        const { client, session } = connect()
        await flush()
        session.appendChunk.mockImplementation(() => {
            throw new Error('pipeline bug')
        })
        expect(() => client.emit('message', Buffer.from([1, 2, 3]), true)).not.toThrow()
        expect(client.close).toHaveBeenCalledWith(1008, 'Malformed frame')
    })

    it('answers end with the take’s tail, recording-complete, then a normal close', async () => {
        const { client, session, text } = connect()
        await flush()
        text('{"type":"end"}')
        await flush()
        expect(session.close).toHaveBeenCalledTimes(1)
        expect(client.sent).toEqual([{ type: 'recording-complete' }])
        expect(client.close).toHaveBeenCalledWith(1000, 'Recording complete')
    })
})
