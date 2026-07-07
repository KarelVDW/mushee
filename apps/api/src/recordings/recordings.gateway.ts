import { Logger, OnApplicationShutdown } from '@nestjs/common';
import {
  OnGatewayConnection,
  OnGatewayDisconnect,
  WebSocketGateway,
} from '@nestjs/websockets';
import { fromNodeHeaders } from 'better-auth/node';
import type { IncomingMessage } from 'http';
import type { RawData, WebSocket } from 'ws';

import { auth } from '../auth/auth';
import { BetaService } from '../beta/beta.service';
import { ScoresService } from '../scores/scores.service';
import type { RecordingCreditBalance } from './recording-credits.service';
import { RecordingCreditsService } from './recording-credits.service';
import { RecordingsService } from './recordings.service';
import type { RecordingSession } from './RecordingSession';

interface RecordingMetaMessage {
  type: 'meta';
  bpm: number;
  timeSignature: { beats: number; beatType: number } | null;
  /** Sounding − written, in semitones. Trumpet B♭ = −2, French Horn = −7, Piccolo = +12. */
  chromaticTranspose?: number;
  /** Selected instrument id (e.g. 'trumpet'). Optional hint that seeds the
   *  adaptive profile's frequency window; auto-detection stays authoritative. */
  instrumentId?: string;
  /** MediaRecorder encoding the client negotiated (e.g. 'audio/webm;codecs=opus',
   *  Safari: 'audio/mp4'). Seeds ffmpeg's input-format hint; `null`/absent means
   *  the browser default was used and ffmpeg probes the container. */
  mimeType?: string | null;
}

interface RecordingEndMessage {
  type: 'end';
}

type RecordingControlMessage = RecordingMetaMessage | RecordingEndMessage;

/** Reasons a recording connection is refused; the client maps these to dialogs. */
type RecordingErrorCode =
  | 'score-required'
  | 'score-not-found'
  | 'concurrent-recording'
  | 'beta-pending';

/** Largest single WebSocket frame we accept (defense against memory abuse via
 *  oversized audio chunks). One ~1s PCM/Opus chunk is well under this. */
const MAX_PAYLOAD_BYTES = 2 * 1024 * 1024;

/** Policy-violation close code (RFC 6455) — used to reject unauthorized clients. */
const WS_POLICY_VIOLATION = 1008;

/** Internal-error close code (RFC 6455) — setup failed through no fault of the client. */
const WS_INTERNAL_ERROR = 1011;

/** Most bytes a client may buffer while session setup (auth, score, credits)
 *  is still resolving. Normal clients send ~1 chunk/second, so anything near
 *  this during the sub-second setup window is abuse, not audio. */
const MAX_PENDING_BYTES = 8 * 1024 * 1024;

/** Keepalive cadence. A peer that misses a whole interval's pong is dead —
 *  without this, a silently-dropped TCP connection keeps its session (and
 *  credit meter) alive until kernel timeouts fire, many minutes later. */
const KEEPALIVE_INTERVAL_MS = 30_000;

/** Going-away close code (RFC 6455) — sent when the server shuts down. */
const WS_GOING_AWAY = 1001;

@WebSocketGateway({ path: '/recording', maxPayload: MAX_PAYLOAD_BYTES })
export class RecordingsGateway
  implements
    OnGatewayConnection<WebSocket>,
    OnGatewayDisconnect<WebSocket>,
    OnApplicationShutdown
{
  private readonly logger = new Logger(RecordingsGateway.name);
  private readonly sessions = new WeakMap<WebSocket, RecordingSession>();
  /** Live sockets, tracked so shutdown can drain them (WeakMap can't iterate). */
  private readonly clients = new Set<WebSocket>();

  constructor(
    private readonly recordingsService: RecordingsService,
    private readonly creditsService: RecordingCreditsService,
    private readonly scoresService: ScoresService,
    private readonly betaService: BetaService,
  ) {}

  handleConnection(client: WebSocket, request: IncomingMessage): void {
    // Session setup is async (auth, score ownership, credit balance); buffer
    // any frames that arrive before it resolves so the first audio chunks
    // aren't dropped, then either flush them into the session or discard them
    // if the connection was rejected.
    const pending: Array<{ data: RawData; isBinary: boolean }> = [];
    let pendingBytes = 0;
    let session: RecordingSession | null = null;
    let closed = false;

    this.clients.add(client);

    // Keepalive: terminate peers that stop answering pings so their sessions
    // (and credit meters) don't outlive a silently-dead connection.
    let alive = true;
    const keepalive = setInterval(() => {
      if (!alive) {
        this.logger.warn('Recording client missed keepalive; terminating');
        client.terminate();
        return;
      }
      alive = false;
      client.ping();
    }, KEEPALIVE_INTERVAL_MS);
    client.on('pong', () => {
      alive = true;
    });

    client.on('message', (data: RawData, isBinary: boolean) => {
      if (session) {
        this.handleMessage(session, data, isBinary);
      } else {
        pendingBytes += this.byteLength(data);
        if (pendingBytes > MAX_PENDING_BYTES) {
          this.logger.warn('Closing recording socket: pre-session buffer exceeded');
          pending.length = 0;
          closed = true;
          client.close(WS_POLICY_VIOLATION, 'Too much data before session open');
          return;
        }
        pending.push({ data, isBinary });
      }
    });
    client.on('close', () => {
      closed = true;
      clearInterval(keepalive);
    });

    void this.openSession(client, request)
      .then((created) => {
        if (!created) return;
        if (closed || client.readyState !== client.OPEN) {
          void created.close();
          return;
        }
        this.sessions.set(client, created);
        session = created;

        for (const msg of pending) {
          this.handleMessage(created, msg.data, msg.isBinary);
        }
        pending.length = 0;
      })
      .catch((err: unknown) => {
        // Session setup failed unexpectedly (e.g. transient DB error). Contain
        // it here — an unhandled rejection would take down the whole process.
        const message = err instanceof Error ? err.message : String(err);
        this.logger.error(`Recording connection setup failed: ${message}`);
        pending.length = 0;
        client.close(WS_INTERNAL_ERROR, 'Recording session failed');
      });
  }

  handleDisconnect(client: WebSocket): void {
    this.clients.delete(client);
    const session = this.sessions.get(client);
    this.sessions.delete(client);
    if (session) {
      void session.close().catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        this.logger.warn(`Session close on disconnect failed: ${message}`);
      });
    }
    this.logger.log('Recording client disconnected');
  }

  /**
   * Drain on SIGTERM (k8s pod rotation): close every live session so pipeline
   * finalize runs, outcomes are persisted, and per-user locks release — instead
   * of ffmpeg children dying with the cgroup mid-take.
   */
  async onApplicationShutdown(): Promise<void> {
    if (!this.clients.size) return;
    this.logger.log(`Draining ${this.clients.size} recording connection(s)...`);
    const closures: Promise<void>[] = [];
    for (const client of this.clients) {
      const session = this.sessions.get(client);
      this.sessions.delete(client);
      if (session) {
        closures.push(
          session.close().catch((err: unknown) => {
            this.logger.warn(
              `Session close on shutdown failed: ${err instanceof Error ? err.message : String(err)}`,
            );
          }),
        );
      }
      client.close(WS_GOING_AWAY, 'Server shutting down');
    }
    this.clients.clear();
    await Promise.all(closures);
  }

  /**
   * Authenticate the connection and validate every recording precondition:
   * a score the user owns, no recording already in flight, and daily credits
   * left. Rejections notify the client with a typed message before closing.
   */
  private async openSession(
    client: WebSocket,
    request: IncomingMessage,
  ): Promise<RecordingSession | null> {
    const user = await this.authenticate(request);
    if (!user) {
      this.logger.warn('Rejected unauthenticated recording connection');
      client.close(WS_POLICY_VIOLATION, 'Unauthorized');
      return null;
    }

    if (await this.betaService.isAwaitingApproval(user.id)) {
      this.logger.warn(`Rejected recording from unapproved beta user ${user.id}`);
      this.reject(client, 'beta-pending');
      return null;
    }

    const scoreId = this.scoreIdFrom(request);
    if (!scoreId) {
      this.logger.warn(`Rejected recording without scoreId (user ${user.id})`);
      this.reject(client, 'score-required');
      return null;
    }

    // Every recording belongs to a score; verify it exists and is the user's.
    try {
      await this.scoresService.findOne(user.id, scoreId);
    } catch {
      this.logger.warn(
        `Rejected recording for inaccessible score ${scoreId} (user ${user.id})`,
      );
      this.reject(client, 'score-not-found');
      return null;
    }

    const session = await this.recordingsService.createSession(user.id, scoreId, {
      onUpdate: (update) => {
        if (client.readyState !== client.OPEN) return;
        client.send(JSON.stringify({ type: 'score-update', ...update }));
      },
      onLimitReached: (balance) => this.sendLimit(client, balance),
      onSessionCap: (reason) => {
        if (client.readyState !== client.OPEN) return;
        client.send(JSON.stringify({ type: 'recording-capped', reason }));
      },
    });
    if (!session) {
      this.reject(client, 'concurrent-recording');
      return null;
    }

    // From here on the session (and its one-per-user lock) is live — every
    // failure path must close it, or the user is locked out of recording
    // until the heartbeat goes stale.
    try {
      // No credits left today — tell the client why before it streams anything.
      const balance = await this.creditsService.balance(user.id);
      if (balance.exhausted) {
        this.logger.log(`Rejected recording with exhausted budget (user ${user.id})`);
        await session.close();
        this.sendLimit(client, balance);
        client.close(WS_POLICY_VIOLATION, 'Daily recording limit reached');
        return null;
      }

      await session.open();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Failed to open recording session: ${message}`);
      await session.close().catch(() => undefined);
      client.close(WS_INTERNAL_ERROR, 'Recording session failed');
      return null;
    }

    this.logger.log(
      `Recording client connected (user ${user.id}, score ${scoreId})`,
    );
    return session;
  }

  private scoreIdFrom(request: IncomingMessage): string | null {
    const url = new URL(request.url ?? '', 'http://placeholder');
    return url.searchParams.get('scoreId');
  }

  private reject(client: WebSocket, code: RecordingErrorCode): void {
    if (client.readyState === client.OPEN) {
      client.send(JSON.stringify({ type: 'recording-error', code }));
    }
    client.close(WS_POLICY_VIOLATION, code);
  }

  private sendLimit(client: WebSocket, balance: RecordingCreditBalance): void {
    if (client.readyState !== client.OPEN) return;
    client.send(
      JSON.stringify({
        type: 'recording-limit',
        planId: balance.tier.id,
        planName: balance.tier.name,
        limitSeconds: balance.tier.dailyRecordingCredits,
        usedSeconds: balance.used,
      }),
    );
  }

  private async authenticate(
    request: IncomingMessage,
  ): Promise<{ id: string } | null> {
    try {
      const session = await auth.api.getSession({
        headers: fromNodeHeaders(request.headers),
      });
      return session?.user ?? null;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Recording session lookup failed: ${message}`);
      return null;
    }
  }

  private handleMessage(
    session: RecordingSession,
    data: RawData,
    isBinary: boolean,
  ): void {
    if (isBinary) {
      session.appendChunk(this.toBuffer(data));
      return;
    }

    let parsed: RecordingControlMessage;
    try {
      parsed = JSON.parse(
        this.toBuffer(data).toString('utf8'),
      ) as RecordingControlMessage;
    } catch {
      this.logger.warn('Received non-JSON text frame on recording socket');
      return;
    }

    if (parsed.type === 'meta') {
      session.setMeta({
        bpm: parsed.bpm,
        timeSignature: parsed.timeSignature,
        chromaticTranspose: parsed.chromaticTranspose,
        instrumentId: parsed.instrumentId,
        mimeType: parsed.mimeType,
      });
    } else if (parsed.type === 'end') {
      session.finalize();
    }
  }

  private toBuffer(data: RawData): Buffer {
    if (Buffer.isBuffer(data)) return data;
    if (Array.isArray(data)) return Buffer.concat(data);
    return Buffer.from(data);
  }

  private byteLength(data: RawData): number {
    if (Buffer.isBuffer(data)) return data.length;
    if (Array.isArray(data)) return data.reduce((sum, buf) => sum + buf.length, 0);
    return data.byteLength;
  }
}
