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
import type { RecordingPipeline } from './RecordingPipeline';
import { RecordingsService } from './recordings.service';

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

/** Largest single WebSocket frame we accept (defense against memory abuse via
 *  oversized audio chunks). One ~1s PCM/Opus chunk is well under this. */
const MAX_PAYLOAD_BYTES = 2 * 1024 * 1024;

/** Policy-violation close code (RFC 6455) — used to reject unauthenticated clients. */
const WS_POLICY_VIOLATION = 1008;

@WebSocketGateway({ path: '/recording', maxPayload: MAX_PAYLOAD_BYTES })
export class RecordingsGateway
  implements OnGatewayConnection<WebSocket>, OnGatewayDisconnect<WebSocket>
{
  private readonly logger = new Logger(RecordingsGateway.name);
  private readonly pipelines = new WeakMap<WebSocket, RecordingPipeline>();

  constructor(private readonly recordingsService: RecordingsService) {}

  handleConnection(client: WebSocket, request: IncomingMessage): void {
    // Session validation is async; buffer any frames that arrive before it
    // resolves so the first audio chunks aren't dropped, then either flush
    // them into the pipeline or discard them if the client is unauthorized.
    const pending: Array<{ data: RawData; isBinary: boolean }> = [];
    let pipeline: RecordingPipeline | null = null;
    let closed = false;

    client.on('message', (data: RawData, isBinary: boolean) => {
      if (pipeline) {
        this.handleMessage(pipeline, data, isBinary);
      } else {
        pending.push({ data, isBinary });
      }
    });
    client.on('close', () => {
      closed = true;
    });

    void this.authenticate(request).then((user) => {
      if (!user) {
        this.logger.warn('Rejected unauthenticated recording connection');
        client.close(WS_POLICY_VIOLATION, 'Unauthorized');
        return;
      }
      if (closed || client.readyState !== client.OPEN) return;

      this.logger.log(`Recording client connected (user ${user.id})`);
      const created = this.recordingsService.createPipeline();
      created.setOnUpdate((update) => {
        if (client.readyState !== client.OPEN) return;
        client.send(JSON.stringify({ type: 'score-update', ...update }));
      });
      this.pipelines.set(client, created);
      pipeline = created;

      for (const msg of pending) {
        this.handleMessage(created, msg.data, msg.isBinary);
      }
      pending.length = 0;
    });
  }

  handleDisconnect(client: WebSocket): void {
    const p = this.pipelines.get(client);
    this.pipelines.delete(client);
    if (p) {
      void p.finalize().catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        this.logger.warn(`Pipeline finalize on disconnect failed: ${message}`);
      });
    }
    this.logger.log('Recording client disconnected');
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
    pipeline: RecordingPipeline,
    data: RawData,
    isBinary: boolean,
  ): void {
    if (isBinary) {
      pipeline.appendChunk(this.toBuffer(data));
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
      pipeline.setMeta({
        bpm: parsed.bpm,
        timeSignature: parsed.timeSignature,
        chromaticTranspose: parsed.chromaticTranspose,
        instrumentId: parsed.instrumentId,
      });
    } else if (parsed.type === 'end') {
      void pipeline.finalize();
    }
  }

  private toBuffer(data: RawData): Buffer {
    if (Buffer.isBuffer(data)) return data;
    if (Array.isArray(data)) return Buffer.concat(data);
    return Buffer.from(data);
  }
}
