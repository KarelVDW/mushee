import { readFile } from 'fs/promises';
import { resolve } from 'path';

import mongoose from 'mongoose';
import { Client as PgClient } from 'pg';
import { WebSocket, WebSocketServer } from 'ws';

import type { RawData } from 'ws';

import type {
  MxmlMeasure,
  MxmlMeasureEntry,
} from '../src/recordings/mxml.types';
import { RecordingsService } from '../src/recordings/recordings.service';

const PORT = Number(process.env.TEST_PORT ?? 4099);
const BPM = 90;
const CHUNK_SIZE = 16 * 1024;
const CHUNK_INTERVAL_MS = 100;
const POST_END_WAIT_MS = 20000;
const CREATE_SCORE = ['1', 'true', 'yes'].includes(
  (process.env.TEST_CREATE_SCORE ?? '').toLowerCase(),
);

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

/**
 * Densify the sparse measure map into a contiguous MxmlMeasure[] suitable for
 * the front-end's ScorePartwise structure. Gaps are filled with full-measure
 * rests; the first measure carries the time-signature attributes.
 */
function densify(
  sparse: Record<number, MxmlMeasure>,
  beatsPerMeasure: number,
  beatType: number,
): MxmlMeasure[] {
  const indices = Object.keys(sparse)
    .map(Number)
    .sort((a, b) => a - b);
  if (!indices.length) return [];
  const maxIdx = indices[indices.length - 1];
  const out: MxmlMeasure[] = [];
  for (let i = 0; i <= maxIdx; i++) {
    if (sparse[i]) {
      out.push({ ...sparse[i], number: String(i + 1) });
      continue;
    }
    const entries: MxmlMeasureEntry[] = [];
    if (i === 0) {
      entries.push({
        _type: 'attributes',
        divisions: 12,
        time: [{ beats: String(beatsPerMeasure), beatType: String(beatType) }],
      });
    }
    entries.push({
      _type: 'note',
      rest: { measure: true },
      duration: 12 * beatsPerMeasure,
      voice: '1',
    });
    out.push({ number: String(i + 1), entries });
  }
  return out;
}

async function persistToDatabase(
  measures: Record<number, MxmlMeasure>,
): Promise<void> {
  const dense = densify(measures, 4, 4);
  if (!dense.length) {
    console.log('[persist] no measures to persist, skipping');
    return;
  }

  const score = {
    partList: { scoreParts: [{ id: 'P1', partName: 'Recorded' }] },
    parts: [{ id: 'P1', measures: dense }],
  };

  const pg = new PgClient({
    host: process.env.POSTGRES_HOST ?? 'localhost',
    port: Number(process.env.POSTGRES_PORT ?? 5432),
    user: process.env.POSTGRES_USER ?? 'mushee',
    password: process.env.POSTGRES_PASSWORD ?? 'mushee',
    database: process.env.POSTGRES_DB ?? 'mushee',
  });
  await pg.connect();
  try {
    const userResult = await pg.query<{ id: string }>(
      'SELECT id FROM "user" LIMIT 1',
    );
    if (!userResult.rows.length) {
      throw new Error('No users in database — sign up via the web app first');
    }
    const userId = userResult.rows[0].id;
    const title = `Test recording ${new Date()
      .toISOString()
      .slice(0, 19)
      .replace('T', ' ')}`;
    const storageKey = `scores/${userId}/${Date.now()}.musicxml`;
    const inserted = await pg.query<{ id: string }>(
      `INSERT INTO scores ("userId", title, "storageKey")
       VALUES ($1, $2, $3) RETURNING id`,
      [userId, title, storageKey],
    );
    const scoreId = inserted.rows[0].id;

    await mongoose.connect(
      process.env.MONGO_URI ?? 'mongodb://localhost:27017/mushee',
    );
    try {
      await mongoose.connection.collection('cachedscores').insertOne({
        scoreId,
        data: score,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    } finally {
      await mongoose.disconnect();
    }

    console.log(
      `[persist] created score ${scoreId} ("${title}") for user ${userId}`,
    );
  } finally {
    await pg.end();
  }
}

async function main(): Promise<void> {
  const audioPath =
    process.env.TEST_AUDIO ?? resolve(__dirname, 'fixtures/test.webm');
  const audio = await readFile(audioPath);
  console.log(`[client] loaded ${audio.byteLength} bytes from ${audioPath}`);
  console.log(`[client] create-score in DB: ${CREATE_SCORE}`);

  const stopServer = await startServer();
  let result: { measures: Record<number, MxmlMeasure> } = { measures: {} };
  try {
    result = await runClient(audio);
  } finally {
    await stopServer();
    console.log('[server] closed');
  }

  if (CREATE_SCORE) {
    await persistToDatabase(result.measures);
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
