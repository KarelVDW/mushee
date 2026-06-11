import { Logger } from '@nestjs/common';
import {
  OnGatewayConnection,
  OnGatewayDisconnect,
  WebSocketGateway,
} from '@nestjs/websockets';
import { fromNodeHeaders } from 'better-auth/node';
import type { IncomingMessage } from 'http';
import type { RawData, WebSocket } from 'ws';

import { auth } from '../auth/auth';
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
}

interface RecordingEndMessage {
  type: 'end';
}

type RecordingControlMessage = RecordingMetaMessage | RecordingEndMessage;

/** Reasons a recording connection is refused; the client maps these to dialogs. */
type RecordingErrorCode =
  | 'score-required'
  | 'score-not-found'
  | 'concurrent-recording';

/** Largest single WebSocket frame we accept (defense against memory abuse via
 *  oversized audio chunks). One ~1s PCM/Opus chunk is well under this. */
const MAX_PAYLOAD_BYTES = 2 * 1024 * 1024;

/** Policy-violation close code (RFC 6455) — used to reject unauthorized clients. */
const WS_POLICY_VIOLATION = 1008;

@WebSocketGateway({ path: '/recording', maxPayload: MAX_PAYLOAD_BYTES })
export class RecordingsGateway
  implements OnGatewayConnection<WebSocket>, OnGatewayDisconnect<WebSocket>
{
  private readonly logger = new Logger(RecordingsGateway.name);
  private readonly sessions = new WeakMap<WebSocket, RecordingSession>();

  constructor(
    private readonly recordingsService: RecordingsService,
    private readonly creditsService: RecordingCreditsService,
    private readonly scoresService: ScoresService,
  ) {}

  handleConnection(client: WebSocket, request: IncomingMessage): void {
    // Session setup is async (auth, score ownership, credit balance); buffer
    // any frames that arrive before it resolves so the first audio chunks
    // aren't dropped, then either flush them into the session or discard them
    // if the connection was rejected.
    const pending: Array<{ data: RawData; isBinary: boolean }> = [];
    let session: RecordingSession | null = null;
    let closed = false;

    client.on('message', (data: RawData, isBinary: boolean) => {
      if (session) {
        this.handleMessage(session, data, isBinary);
      } else {
        pending.push({ data, isBinary });
      }
    });
    client.on('close', () => {
      closed = true;
    });

    void this.openSession(client, request).then((created) => {
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
    });
  }

  handleDisconnect(client: WebSocket): void {
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
    });
    if (!session) {
      this.reject(client, 'concurrent-recording');
      return null;
    }

    // No credits left today — tell the client why before it streams anything.
    const balance = await this.creditsService.balance(user.id);
    if (balance.exhausted) {
      this.logger.log(`Rejected recording with exhausted budget (user ${user.id})`);
      await session.close();
      this.sendLimit(client, balance);
      client.close(WS_POLICY_VIOLATION, 'Daily recording limit reached');
      return null;
    }

    try {
      await session.open();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Failed to open recording session: ${message}`);
      await session.close();
      client.close(WS_POLICY_VIOLATION, 'Recording session failed');
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
}
