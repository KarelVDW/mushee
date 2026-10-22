import { ForbiddenException, Logger, NotFoundException, OnApplicationShutdown } from '@nestjs/common'
import { OnGatewayConnection, OnGatewayDisconnect, WebSocketGateway } from '@nestjs/websockets'
import { fromNodeHeaders } from 'better-auth/node'
import { plainToInstance } from 'class-transformer'
import { isUUID, validateSync, type ValidationError } from 'class-validator'
import type { IncomingMessage } from 'http'
import type { RawData, WebSocket } from 'ws'

import { auth } from '../auth/auth.config'
import { BetaService } from '../beta/beta.service'
import { ScoresService } from '../scores/scores.service'
import { RecordingMetaDto } from './dto/recording-meta.dto'
import { describeError } from './pipeline/describe-error'
import type { ScoreUpdate, SourceResolution } from './pipeline/recording-pipeline'
import type { RecordingCreditBalance } from './recording-credits.service'
import type { RecordingSession, SessionCapReason } from './recording-session'
import { RecordingSessionsService } from './recording-sessions.service'

/** The client stopped capturing and has flushed its last audio chunk. The
 *  socket stays open: the server finalizes the pipeline, streams the trailing
 *  notes as `score-update`s, then answers `recording-complete` and closes. */
interface RecordingEndMessage {
    type: 'end'
}

/** A text frame that passed `parseControl`: the take's meta (whitelisted by its DTO) or the end of capture. */
type RecordingControlMessage = { type: 'meta'; meta: RecordingMetaDto } | RecordingEndMessage

/** Reasons a recording connection is refused; the client maps these to dialogs. */
type RecordingErrorCode = 'score-required' | 'score-not-found' | 'concurrent-recording' | 'beta-pending'

/** Every frame the server sends on the recording socket — the wire protocol's server half. */
type RecordingServerFrame =
    /** Measures transcribed so far (deltas as notes settle, then the take's tail). */
    | ({ type: 'score-update' } & ScoreUpdate)
    /** What the pipeline decided is at the mic, and on what evidence. */
    | ({ type: 'recording-source' } & SourceResolution)
    /** Transcription down/back — the session stops metering credits while it is down. */
    | { type: 'recording-health'; ok: boolean }
    /** The day's budget (and pack seconds) ran out, before or during the take. */
    | { type: 'recording-limit'; planId: string; planName: string; limitSeconds: number | null; usedSeconds: number }
    /** A hard session cap (duration/bytes) stopped the take. */
    | { type: 'recording-capped'; reason: SessionCapReason }
    /** The connection was refused; sent just before the 1008 close. */
    | { type: 'recording-error'; code: RecordingErrorCode }
    /** The take's tail has been streamed after the client's `end`; the socket closes next. */
    | { type: 'recording-complete' }

/** Largest single WebSocket frame we accept (defense against memory abuse via
 *  oversized audio chunks). One ~1s PCM/Opus chunk is well under this. */
const MAX_PAYLOAD_BYTES = 2 * 1024 * 1024

/** Policy-violation close code (RFC 6455) — used to reject unauthorized clients. */
const WS_POLICY_VIOLATION = 1008

/** Internal-error close code (RFC 6455) — setup failed through no fault of the client. */
const WS_INTERNAL_ERROR = 1011

/** Most bytes a client may buffer while session setup (auth, score, credits)
 *  is still resolving. Normal clients send ~1 chunk/second, so anything near
 *  this during the sub-second setup window is abuse, not audio. */
const MAX_PENDING_BYTES = 8 * 1024 * 1024

/** Keepalive cadence. A peer that misses a whole interval's pong is dead —
 *  without this, a silently-dropped TCP connection keeps its session (and
 *  credit meter) alive until kernel timeouts fire, many minutes later. */
const KEEPALIVE_INTERVAL_MS = 30_000

/** Going-away close code (RFC 6455) — sent when the server shuts down. */
const WS_GOING_AWAY = 1001

/** Normal-closure close code (RFC 6455) — a recording completed gracefully. */
const WS_NORMAL_CLOSURE = 1000

@WebSocketGateway({ path: '/recording', maxPayload: MAX_PAYLOAD_BYTES })
export class RecordingsGateway implements OnGatewayConnection<WebSocket>, OnGatewayDisconnect<WebSocket>, OnApplicationShutdown {
    private readonly logger = new Logger(RecordingsGateway.name)
    /** Every live socket and its session (`null` until setup resolves) — what messages route to and shutdown drains. */
    private readonly connections = new Map<WebSocket, RecordingSession | null>()

    constructor(
        private readonly recordingSessions: RecordingSessionsService,
        private readonly scoresService: ScoresService,
        private readonly betaService: BetaService,
    ) {}

    handleConnection(client: WebSocket, request: IncomingMessage): void {
        // Session setup is async (auth, score ownership, credit balance); buffer
        // any frames that arrive before it resolves so the first audio chunks
        // aren't dropped, then either flush them into the session or discard them
        // if the connection was rejected.
        const pending: Array<{ data: RawData; isBinary: boolean }> = []
        let pendingBytes = 0
        let closed = false

        this.connections.set(client, null)

        // Keepalive: terminate peers that stop answering pings so their sessions
        // (and credit meters) don't outlive a silently-dead connection.
        let alive = true
        const keepalive = setInterval(() => {
            if (!alive) {
                this.logger.warn('Recording client missed keepalive; terminating')
                client.terminate()
                return
            }
            alive = false
            client.ping()
        }, KEEPALIVE_INTERVAL_MS)
        client.on('pong', () => {
            alive = true
        })

        client.on('message', (data: RawData, isBinary: boolean) => {
            // ws does not guard its listeners: a throw here would surface as an
            // uncaught exception and take the process (and every live take) down.
            try {
                const session = this.connections.get(client)
                if (session) {
                    this.handleMessage(client, session, data, isBinary)
                } else {
                    pendingBytes += this.byteLength(data)
                    if (pendingBytes > MAX_PENDING_BYTES) {
                        this.logger.warn('Closing recording socket: pre-session buffer exceeded')
                        pending.length = 0
                        closed = true
                        client.close(WS_POLICY_VIOLATION, 'Too much data before session open')
                        return
                    }
                    pending.push({ data, isBinary })
                }
            } catch (err: unknown) {
                this.closeMalformed(client, err)
            }
        })
        client.on('close', () => {
            closed = true
            clearInterval(keepalive)
        })

        void this.openSession(client, request)
            .then((created) => {
                if (!created) return
                // The socket may have gone while setup ran (handleDisconnect already
                // dropped it): close the session instead of re-registering it.
                if (closed || client.readyState !== client.OPEN) {
                    void this.closeQuietly(created, 'after early disconnect')
                    return
                }
                this.connections.set(client, created)

                try {
                    for (const msg of pending) {
                        this.handleMessage(client, created, msg.data, msg.isBinary)
                    }
                } catch (err: unknown) {
                    this.closeMalformed(client, err)
                }
                pending.length = 0
            })
            .catch((err: unknown) => {
                // Session setup failed unexpectedly (e.g. transient DB error). Contain
                // it here — an unhandled rejection would take down the whole process.
                this.logger.error(`Recording connection setup failed: ${describeError(err)}`)
                pending.length = 0
                client.close(WS_INTERNAL_ERROR, 'Recording session failed')
            })
    }

    handleDisconnect(client: WebSocket): void {
        const session = this.connections.get(client)
        this.connections.delete(client)
        if (session) void this.closeQuietly(session, 'on disconnect')
        this.logger.log('Recording client disconnected')
    }

    /**
     * Drain on SIGTERM (k8s pod rotation): close every live session so pipeline
     * finalize runs, outcomes are persisted, and per-user locks release — instead
     * of ffmpeg children dying with the cgroup mid-take.
     */
    async onApplicationShutdown(): Promise<void> {
        if (!this.connections.size) return
        this.logger.log(`Draining ${this.connections.size} recording connection(s)...`)
        const closures: Promise<void>[] = []
        for (const [client, session] of this.connections) {
            if (session) closures.push(this.closeQuietly(session, 'on shutdown'))
            client.close(WS_GOING_AWAY, 'Server shutting down')
        }
        this.connections.clear()
        await Promise.all(closures)
    }

    /**
     * Authenticate the connection and validate every recording precondition:
     * a score the user owns, no recording already in flight, and daily credits
     * left. Rejections notify the client with a typed message before closing.
     */
    private async openSession(client: WebSocket, request: IncomingMessage): Promise<RecordingSession | null> {
        const user = await this.authenticate(request)
        if (!user) {
            this.logger.warn('Rejected unauthenticated recording connection')
            client.close(WS_POLICY_VIOLATION, 'Unauthorized')
            return null
        }

        if (await this.betaService.isAwaitingApproval(user.id)) {
            this.logger.warn(`Rejected recording from unapproved beta user ${user.id}`)
            this.reject(client, 'beta-pending')
            return null
        }

        const scoreId = this.scoreIdFrom(request)
        if (!scoreId) {
            this.logger.warn(`Rejected recording without scoreId (user ${user.id})`)
            this.reject(client, 'score-required')
            return null
        }

        // Every recording belongs to a score; verify it exists and is the user's.
        // A malformed id names no score and is never sent to the uuid column.
        if (!isUUID(scoreId) || !(await this.ownsScore(user.id, scoreId))) {
            this.logger.warn(`Rejected recording for inaccessible score ${scoreId} (user ${user.id})`)
            this.reject(client, 'score-not-found')
            return null
        }

        // A throw here (the session already closed itself) reaches handleConnection's
        // catch, which answers 1011.
        const opened = await this.recordingSessions.open(user.id, scoreId, {
            onUpdate: (update) => this.send(client, { type: 'score-update', ...update }),
            onLimitReached: (balance) => this.sendLimit(client, balance),
            onSessionCap: (reason) => this.send(client, { type: 'recording-capped', reason }),
            // The client shows the resolution so a wrong classification is
            // user-visible feedback rather than a silently mangled transcription.
            onSourceResolved: (resolution) => this.send(client, { type: 'recording-source', ...resolution }),
            // Only the state crosses the wire — the internal error text stays in the server log.
            onHealth: (health) => this.send(client, { type: 'recording-health', ok: health.ok }),
        })
        if ('rejected' in opened) {
            if (opened.rejected === 'concurrent-recording') {
                this.reject(client, 'concurrent-recording')
            } else {
                // No credits left today — tell the client why before it streams anything.
                this.sendLimit(client, opened.balance)
                client.close(WS_POLICY_VIOLATION, 'Daily recording limit reached')
            }
            return null
        }

        this.logger.log(`Recording client connected (user ${user.id}, score ${scoreId})`)
        return opened.session
    }

    /**
     * Whether the score exists and is the user's. Only the lookup's own answers
     * mean no: any other failure (a database outage) propagates to
     * handleConnection's catch and its 1011 close, rather than passing for
     * 'score-not-found', which the client takes as a reason to stop silently.
     */
    private async ownsScore(userId: string, scoreId: string): Promise<boolean> {
        try {
            await this.scoresService.findOne(userId, scoreId)
            return true
        } catch (err: unknown) {
            if (err instanceof NotFoundException || err instanceof ForbiddenException) return false
            throw err
        }
    }

    private scoreIdFrom(request: IncomingMessage): string | null {
        const url = new URL(request.url ?? '', 'http://placeholder')
        return url.searchParams.get('scoreId')
    }

    /** Send one protocol frame; a socket that is no longer open is skipped. */
    private send(client: WebSocket, frame: RecordingServerFrame): void {
        if (client.readyState !== client.OPEN) return
        client.send(JSON.stringify(frame))
    }

    private reject(client: WebSocket, code: RecordingErrorCode): void {
        this.send(client, { type: 'recording-error', code })
        client.close(WS_POLICY_VIOLATION, code)
    }

    private sendLimit(client: WebSocket, balance: RecordingCreditBalance): void {
        this.send(client, {
            type: 'recording-limit',
            planId: balance.tier.id,
            planName: balance.tier.name,
            limitSeconds: balance.tier.dailyRecordingCredits,
            usedSeconds: balance.used,
        })
    }

    /** Close a session where nothing is left to report a failure to: log it and carry on. */
    private closeQuietly(session: RecordingSession, context: string): Promise<void> {
        return session.close().catch((err: unknown) => {
            this.logger.warn(`Session close ${context} failed: ${describeError(err)}`)
        })
    }

    private async authenticate(request: IncomingMessage): Promise<{ id: string } | null> {
        try {
            const session = await auth.api.getSession({
                headers: fromNodeHeaders(request.headers),
            })
            return session?.user ?? null
        } catch (err: unknown) {
            this.logger.warn(`Recording session lookup failed: ${describeError(err)}`)
            return null
        }
    }

    private handleMessage(client: WebSocket, session: RecordingSession, data: RawData, isBinary: boolean): void {
        if (isBinary) {
            session.appendChunk(this.toBuffer(data))
            return
        }

        const control = this.parseControl(data)
        if (!control) {
            this.logger.warn('Ignoring malformed text frame on recording socket')
            return
        }

        if (control.type === 'meta') {
            session.setMeta(control.meta)
        } else {
            // The client stopped capturing and is waiting for the take's tail.
            // Close the session (releases the per-user slot right away, then runs
            // the final pipeline pass, which streams the remaining notes out as
            // `score-update`s), acknowledge with `recording-complete`, and only
            // then close the socket — the client keeps it open until that ack so
            // the last moments of the take aren't lost.
            void this.closeQuietly(session, 'on end').then(() => {
                this.send(client, { type: 'recording-complete' })
                client.close(WS_NORMAL_CLOSURE, 'Recording complete')
            })
        }
    }

    /**
     * A text frame as a control message, or null when it is none: anything but
     * a JSON object typed 'meta' or 'end'. Unknown meta keys are dropped
     * (whitelist), and so is each field that fails RecordingMetaDto — only that
     * field: the client sends meta once per take, so dropping the whole frame
     * for one bad value would put the take on every pipeline default (120 bpm,
     * 4/4, no key, no container hint) instead of just that field's.
     */
    private parseControl(data: RawData): RecordingControlMessage | null {
        let parsed: unknown
        try {
            parsed = JSON.parse(this.toBuffer(data).toString('utf8'))
        } catch {
            return null
        }
        if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null
        const { type, ...fields } = parsed as Record<string, unknown>
        if (type === 'end') return { type: 'end' }
        if (type !== 'meta') return null
        const meta = plainToInstance(RecordingMetaDto, fields)
        const invalid = validateSync(meta, { whitelist: true })
        if (invalid.length > 0) {
            // A nested failure (timeSignature.beats) drops its top-level field.
            for (const error of invalid) delete (meta as unknown as Record<string, unknown>)[error.property]
            // Names only: the values are client input and stay out of the logs.
            this.logger.warn(`Dropped invalid recording meta fields: ${this.fieldPaths(invalid).join(', ')}`)
        }
        return { type: 'meta', meta }
    }

    /** The dotted paths of the fields that failed validation, nested ones included. */
    private fieldPaths(errors: ValidationError[], parent = ''): string[] {
        return errors.flatMap((error) => {
            const path = parent ? `${parent}.${error.property}` : error.property
            return error.children?.length ? this.fieldPaths(error.children, path) : [path]
        })
    }

    /** A frame handler threw: drop the client rather than let the error escape into ws. */
    private closeMalformed(client: WebSocket, err: unknown): void {
        this.logger.warn(`Closing recording socket after a frame failed: ${describeError(err)}`)
        client.close(WS_POLICY_VIOLATION, 'Malformed frame')
    }

    private toBuffer(data: RawData): Buffer {
        if (Buffer.isBuffer(data)) return data
        if (Array.isArray(data)) return Buffer.concat(data)
        return Buffer.from(data)
    }

    private byteLength(data: RawData): number {
        if (Buffer.isBuffer(data)) return data.length
        if (Array.isArray(data)) return data.reduce((sum, buf) => sum + buf.length, 0)
        return data.byteLength
    }
}
