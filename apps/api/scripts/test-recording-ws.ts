import { readFile } from 'fs/promises';
import { resolve } from 'path';

import { WebSocket, WebSocketServer } from 'ws';

import type { RawData } from 'ws';

import { RecordingsService } from '../src/recordings/recordings.service';

const PORT = Number(process.env.TEST_PORT ?? 4099);
const BPM = 90;
const CHUNK_SIZE = 16 * 1024;
const CHUNK_INTERVAL_MS = 100;
const POST_END_WAIT_MS = 20000;

interface RecordingControlMessage {
  type: 'meta' | 'end';
  bpm?: number;
  timeSignature?: { beats: number; beatType: number } | null;
}

function toBuffer(data: RawData): Buffer {
  if (Buffer.isBuffer(data)) return data;
  if (Array.isArray(data)) return Buffer.concat(data);
  return Buffer.from(data);
}

async function startServer(): Promise<() => Promise<void>> {
  process.env.BASIC_PITCH_MODEL_DIR = resolve(__dirname, '../model');

  const service = new RecordingsService();
  service.onModuleInit();

  const wss = new WebSocketServer({ port: PORT, path: '/recording' });
  wss.on('connection', (client: WebSocket) => {
    console.log('[server] client connected');
    const pipeline = service.createPipeline();
    pipeline.setOnUpdate((update) => {
      if (client.readyState !== client.OPEN) return;
      client.send(JSON.stringify({ type: 'score-update', ...update }));
    });

    client.on('message', (data: RawData, isBinary: boolean) => {
      if (isBinary) {
        pipeline.appendChunk(toBuffer(data));
        return;
      }
      let parsed: RecordingControlMessage;
      try {
        parsed = JSON.parse(
          toBuffer(data).toString('utf8'),
        ) as RecordingControlMessage;
      } catch {
        console.warn('[server] non-JSON text frame');
        return;
      }
      if (parsed.type === 'meta') {
        pipeline.setMeta({
          bpm: parsed.bpm,
          timeSignature: parsed.timeSignature,
        });
      } else if (parsed.type === 'end') {
        void pipeline.finalize();
      }
    });

    client.on('close', () => {
      console.log('[server] client disconnected');
      void pipeline.finalize().catch((err: unknown) => {
        console.warn('[server] finalize failed:', err);
      });
    });
  });

  await new Promise<void>((res) => wss.once('listening', () => res()));
  console.log(`[server] listening on ws://127.0.0.1:${PORT}/recording`);

  return () =>
    new Promise<void>((res) => {
      wss.close(() => res());
    });
}

async function runClient(audio: Buffer): Promise<void> {
  const ws = new WebSocket(`ws://127.0.0.1:${PORT}/recording`);

  await new Promise<void>((res, rej) => {
    ws.once('open', () => res());
    ws.once('error', rej);
  });
  console.log('[client] connected');

  let updatesReceived = 0;
  ws.on('message', (data: Buffer) => {
    const s = data.toString();
    try {
      const p = JSON.parse(s) as {
        type: string;
        measures?: Record<string, unknown>;
      };
      if (p.type === 'score-update') {
        updatesReceived++;
        const indices = Object.keys(p.measures ?? {});
        console.log(
          `[client] score-update #${updatesReceived} measures=[${indices.join(',')}]`,
        );
        console.log(JSON.stringify(p.measures, null, 2));
      } else {
        console.log(`[client] msg: ${s}`);
      }
    } catch {
      console.log(`[client] raw: ${s.slice(0, 200)}`);
    }
  });

  ws.on('error', (e) => console.error('[client] ws error:', e));
  ws.on('close', (code, reason) =>
    console.log(`[client] closed ${code} ${reason.toString()}`),
  );

  ws.send(
    JSON.stringify({
      type: 'meta',
      bpm: BPM,
      timeSignature: { beats: 4, beatType: 4 },
    }),
  );

  for (let i = 0; i < audio.byteLength; i += CHUNK_SIZE) {
    const chunk = audio.subarray(i, i + CHUNK_SIZE);
    ws.send(chunk);
    await new Promise((r) => setTimeout(r, CHUNK_INTERVAL_MS));
  }
  console.log('[client] sent all chunks, sending end');
  ws.send(JSON.stringify({ type: 'end' }));

  await new Promise((r) => setTimeout(r, POST_END_WAIT_MS));
  ws.close();
  await new Promise((r) => setTimeout(r, 500));
  console.log(`[client] done. total score-updates: ${updatesReceived}`);
}

async function main(): Promise<void> {
  const audioPath =
    process.env.TEST_AUDIO ?? resolve(__dirname, 'fixtures/test.webm');
  const audio = await readFile(audioPath);
  console.log(`[client] loaded ${audio.byteLength} bytes from ${audioPath}`);

  const stopServer = await startServer();
  try {
    await runClient(audio);
  } finally {
    await stopServer();
    console.log('[server] closed');
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
