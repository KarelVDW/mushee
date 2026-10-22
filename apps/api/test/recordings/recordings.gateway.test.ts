import 'reflect-metadata'

import { EventEmitter } from 'node:events'
import type { IncomingMessage } from 'node:http'

import { ForbiddenException, NotFoundException } from '@nestjs/common'
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

function connect({ scoreId = SCORE_ID, findOne = () => Promise.resolve({}) }: { scoreId?: string; findOne?: () => Promise<unknown> } = {}) {
    const session = {
        setMeta: vi.fn(),
        appendChunk: vi.fn(),
        close: vi.fn(() => Promise.resolve()),
    }
    const recordingSessions = { open: vi.fn(() => Promise.resolve({ session })) }
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

    it('drops a meta frame whose fields are mistyped', async () => {
        const { client, session, text } = connect()
        await flush()
        expect(() => text('{"type":"meta","bpm":"fast"}')).not.toThrow()
        text('{"type":"meta","timeSignature":{"beats":0,"beatType":4}}')
        text('{"type":"meta","sourceKind":"kazoo"}')
        text(`{"type":"meta","mimeType":"${'x'.repeat(500)}"}`)
        expect(session.setMeta).not.toHaveBeenCalled()
        expect(client.close).not.toHaveBeenCalled()
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
