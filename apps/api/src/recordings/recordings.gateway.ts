import { Logger } from '@nestjs/common';
import {
  OnGatewayConnection,
  OnGatewayDisconnect,
  WebSocketGateway,
} from '@nestjs/websockets';
import type { RawData, WebSocket } from 'ws';

import type { RecordingPipeline } from './RecordingPipeline';
import { RecordingsService } from './recordings.service';

interface RecordingMetaMessage {
  type: 'meta';
  bpm: number;
  timeSignature: { beats: number; beatType: number } | null;
}

interface RecordingEndMessage {
  type: 'end';
}

type RecordingControlMessage = RecordingMetaMessage | RecordingEndMessage;

@WebSocketGateway({ path: '/recording' })
export class RecordingsGateway
  implements OnGatewayConnection<WebSocket>, OnGatewayDisconnect<WebSocket>
{
  private readonly logger = new Logger(RecordingsGateway.name);
  private readonly pipelines = new WeakMap<WebSocket, RecordingPipeline>();

  constructor(private readonly recordingsService: RecordingsService) {}

  handleConnection(client: WebSocket): void {
    this.logger.log('Recording client connected');
    const pipeline = this.recordingsService.createPipeline();
    pipeline.setOnUpdate((update) => {
      if (client.readyState !== client.OPEN) return;
      client.send(JSON.stringify({ type: 'score-update', ...update }));
    });
    this.pipelines.set(client, pipeline);

    client.on('message', (data: RawData, isBinary: boolean) => {
      const p = this.pipelines.get(client);
      if (!p) return;

      if (isBinary) {
        p.appendChunk(this.toBuffer(data));
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
        p.setMeta({
          bpm: parsed.bpm,
          timeSignature: parsed.timeSignature,
        });
      } else if (parsed.type === 'end') {
        void p.finalize();
      }
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

  private toBuffer(data: RawData): Buffer {
    if (Buffer.isBuffer(data)) return data;
    if (Array.isArray(data)) return Buffer.concat(data);
    return Buffer.from(data);
  }
}
