import { readFile } from 'fs/promises';
import { resolve } from 'path';
import type { RawData } from 'ws';
import { WebSocket, WebSocketServer } from 'ws';

import type { MxmlMeasure } from '../src/recordings/pipeline/mxml.types';
import { usedProviderNames } from '../src/recordings/pipeline/profiles/pipeline-profile';
import { ProfileResolver } from '../src/recordings/pipeline/profiles/profile-resolver';
import { ProviderRegistry } from '../src/recordings/pipeline/providers/provider-registry';
import { RecordingPipeline } from '../src/recordings/pipeline/recording-pipeline';

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
  // Drive the pipeline directly — this script exercises transcription, not
  // the gateway's auth/credit/score checks.
  const registry = new ProviderRegistry({
    basicPitch:
      process.env.BASIC_PITCH_MODEL_DIR ?? resolve(__dirname, '../model'),
    crepeTiny:
      process.env.CREPE_TINY_MODEL_DIR ??
      resolve(__dirname, '../model-crepe-tiny'),
  });
  const resolver = new ProfileResolver();
  void registry.initAll(usedProviderNames());

  const wss = new WebSocketServer({ port: PORT, path: '/recording' });
  wss.on('connection', (client: WebSocket) => {
    console.log('[server] client connected');
    const pipeline = new RecordingPipeline(registry, resolver);
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

async function runClient(
  audio: Buffer,
): Promise<{ measures: Record<number, MxmlMeasure> }> {
  const ws = new WebSocket(`ws://127.0.0.1:${PORT}/recording`);

  await new Promise<void>((res, rej) => {
    ws.once('open', () => res());
    ws.once('error', rej);
  });
  console.log('[client] connected');

  const accumulated: Record<number, MxmlMeasure> = {};
  let updatesReceived = 0;
  ws.on('message', (data: Buffer) => {
    const s = data.toString();
    try {
      const p = JSON.parse(s) as {
        type: string;
        measures?: Record<string, MxmlMeasure>;
      };
      if (p.type === 'score-update') {
        updatesReceived++;
        const indices = Object.keys(p.measures ?? {});
        console.log(
          `[client] score-update #${updatesReceived} measures=[${indices.join(',')}]`,
        );
        if (p.measures) {
          for (const [k, v] of Object.entries(p.measures)) {
            accumulated[Number(k)] = v;
          }
        }
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
  return { measures: accumulated };
}

async function main(): Promise<void> {
  const audioPath =
    process.env.TEST_AUDIO ?? resolve(__dirname, 'fixtures/test.webm');
  const audio = await readFile(audioPath);
  console.log(`[client] loaded ${audio.byteLength} bytes from ${audioPath}`);

  const stopServer = await startServer();
  try {
    const { measures } = await runClient(audio);
    console.log(
      `[client] accumulated ${Object.keys(measures).length} measures`,
    );
  } finally {
    await stopServer();
    console.log('[server] closed');
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
