// Manual integration check for the recording gateway's score/credits/
// concurrency rules. Run against a dev API + its Postgres:
//   API_URL=http://127.0.0.1:4100 POSTGRES_PORT=5532 node scripts/verify-recording-integration.mjs
// Creates a throwaway user, exercises every gateway rejection/limit path over
// the real WebSocket, asserts the credit bookkeeping in Postgres, cleans up.
import { readFile } from 'fs/promises';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

import pg from 'pg';
import { WebSocket } from 'ws';

const API = process.env.API_URL ?? 'http://127.0.0.1:4000';
const WS = API.replace(/^http/, 'ws');
const PG = {
  host: process.env.POSTGRES_HOST ?? 'localhost',
  port: Number(process.env.POSTGRES_PORT ?? 5432),
  user: process.env.POSTGRES_USER ?? 'mushee',
  password: process.env.POSTGRES_PASSWORD ?? 'mushee',
  database: process.env.POSTGRES_DB ?? 'mushee',
};

const __dirname = dirname(fileURLToPath(import.meta.url));
const failures = [];
function check(name, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures.push(name);
}

async function signUp() {
  const email = `rec-verify-${Date.now()}@example.com`;
  const res = await fetch(`${API}/api/auth/sign-up/email`, {
    method: 'POST',
    // Dev trustedOrigins includes the web app origin; better-auth rejects POSTs without one.
    headers: { 'Content-Type': 'application/json', origin: 'http://localhost:3200' },
    body: JSON.stringify({ email, password: 'verify-password-1', name: 'Rec Verify' }),
  });
  if (!res.ok) throw new Error(`sign-up failed: ${res.status} ${await res.text()}`);
  const cookies = res.headers.getSetCookie().map((c) => c.split(';')[0]);
  const body = await res.json();
  return { cookie: cookies.join('; '), userId: body.user.id, email };
}

async function createScore(cookie) {
  const res = await fetch(`${API}/scores`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', cookie },
    body: JSON.stringify({
      title: 'Recording integration check',
      score: {
        partList: { scoreParts: [{ id: 'P1', partName: 'Music' }] },
        parts: [
          {
            id: 'P1',
            measures: [
              {
                number: '1',
                entries: [
                  { _type: 'note', rest: { measure: true }, duration: 48, voice: '1', type: 'whole' },
                ],
              },
            ],
          },
        ],
      },
    }),
  });
  if (!res.ok) throw new Error(`create score failed: ${res.status} ${await res.text()}`);
  return (await res.json()).id;
}

/** Open a recording socket and collect JSON messages + the close event. */
function connect(path, cookie) {
  const ws = new WebSocket(`${WS}${path}`, cookie ? { headers: { cookie } } : undefined);
  const messages = [];
  let closeInfo = null;
  const closed = new Promise((res) => {
    ws.on('close', (code, reason) => {
      closeInfo = { code, reason: reason.toString() };
      res(closeInfo);
    });
  });
  ws.on('message', (data, isBinary) => {
    if (isBinary) return;
    try {
      messages.push(JSON.parse(data.toString()));
    } catch {
      /* ignore */
    }
  });
  const open = new Promise((res, rej) => {
    ws.once('open', res);
    ws.once('error', rej);
  });
  return { ws, messages, closed, open, getClose: () => closeInfo };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function streamAudio(ws, audio, seconds) {
  const chunkSize = 16 * 1024;
  const deadline = Date.now() + seconds * 1000;
  let offset = 0;
  ws.send(JSON.stringify({ type: 'meta', bpm: 90, timeSignature: { beats: 4, beatType: 4 } }));
  while (Date.now() < deadline && ws.readyState === WebSocket.OPEN) {
    ws.send(audio.subarray(offset, offset + chunkSize));
    offset = (offset + chunkSize) % audio.byteLength;
    await sleep(100);
  }
}

async function main() {
  const db = new pg.Client(PG);
  await db.connect();
  const audio = await readFile(resolve(__dirname, 'fixtures/test.webm'));
  const { cookie, userId } = await signUp();
  console.log(`user ${userId}`);
  const scoreId = await createScore(cookie);
  console.log(`score ${scoreId}`);

  // 1. Unauthenticated connection is refused.
  {
    const c = connect(`/recording?scoreId=${scoreId}`);
    await c.open.catch(() => {});
    const close = await c.closed;
    check('unauthenticated → closed 1008', close.code === 1008, JSON.stringify(close));
  }

  // 2. Missing scoreId.
  {
    const c = connect('/recording', cookie);
    await c.open;
    const close = await c.closed;
    check(
      'missing scoreId → recording-error score-required',
      c.messages.some((m) => m.type === 'recording-error' && m.code === 'score-required') &&
        close.code === 1008,
      JSON.stringify({ close, messages: c.messages }),
    );
  }

  // 3. Score that isn't the user's.
  {
    const c = connect('/recording?scoreId=00000000-0000-4000-8000-000000000000', cookie);
    await c.open;
    const close = await c.closed;
    check(
      'foreign/unknown score → recording-error score-not-found',
      c.messages.some((m) => m.type === 'recording-error' && m.code === 'score-not-found') &&
        close.code === 1008,
      JSON.stringify({ close, messages: c.messages }),
    );
  }

  // 4. Happy path: stream ~3s, credits are spent and the session is persisted.
  {
    const c = connect(`/recording?scoreId=${scoreId}`, cookie);
    await c.open;
    await streamAudio(c.ws, audio, 3.2);
    c.ws.send(JSON.stringify({ type: 'end' }));
    await sleep(300);
    c.ws.close();
    await c.closed;
    await sleep(500);

    const usage = await db.query(
      'SELECT "creditsUsed" FROM recording_usage WHERE "userId" = $1',
      [userId],
    );
    const used = usage.rows[0]?.creditsUsed ?? 0;
    check('credits spent ≈ seconds recorded (3-5)', used >= 3 && used <= 5, `used=${used}`);

    const rec = await db.query(
      'SELECT "scoreId", "creditsSpent", "endedAt" FROM recordings WHERE "userId" = $1',
      [userId],
    );
    check('recording row links the score', rec.rows[0]?.scoreId === scoreId, JSON.stringify(rec.rows));
    check(
      'recording row has creditsSpent + endedAt',
      rec.rows[0]?.creditsSpent >= 3 && rec.rows[0]?.endedAt !== null,
      JSON.stringify(rec.rows[0]),
    );
  }

  // 5. Concurrency: second socket while the first records is refused; a
  //    stale lock (crashed instance) is taken over; the old holder's release
  //    must not free the taken-over lock (token guard).
  {
    const first = connect(`/recording?scoreId=${scoreId}`, cookie);
    await first.open;
    const firstStream = streamAudio(first.ws, audio, 4);
    await sleep(600); // let the first session establish

    const second = connect(`/recording?scoreId=${scoreId}`, cookie);
    await second.open;
    const secondClose = await second.closed;
    check(
      'second concurrent recording → recording-error concurrent-recording',
      second.messages.some((m) => m.type === 'recording-error' && m.code === 'concurrent-recording') &&
        secondClose.code === 1008,
      JSON.stringify({ close: secondClose, messages: second.messages }),
    );

    // Simulate a crashed holder: age the heartbeat past the staleness TTL.
    await db.query(
      `UPDATE active_recordings SET "heartbeatAt" = now() - interval '60 seconds' WHERE "userId" = $1`,
      [userId],
    );
    const takeover = connect(`/recording?scoreId=${scoreId}`, cookie);
    await takeover.open;
    await sleep(600);
    check(
      'stale lock (dead heartbeat) → new recording takes over',
      takeover.getClose() === null && takeover.messages.every((m) => m.type !== 'recording-error'),
      JSON.stringify(takeover.messages),
    );

    // The superseded first session ends; its release must not delete the
    // takeover's lock, so yet another connection is still refused.
    await firstStream;
    first.ws.close();
    await first.closed;
    await sleep(500);
    const fourth = connect(`/recording?scoreId=${scoreId}`, cookie);
    await fourth.open;
    const fourthClose = await fourth.closed;
    check(
      'takeover lock survives the old holder\'s release (token guard)',
      fourth.messages.some((m) => m.type === 'recording-error' && m.code === 'concurrent-recording') &&
        fourthClose.code === 1008,
      JSON.stringify({ close: fourthClose, messages: fourth.messages }),
    );

    takeover.ws.close();
    await takeover.closed;
    await sleep(500);

    // Slot released on disconnect: a fresh connection is accepted again.
    const fifth = connect(`/recording?scoreId=${scoreId}`, cookie);
    await fifth.open;
    await sleep(600);
    check(
      'slot released after disconnect → new recording accepted',
      fifth.getClose() === null && fifth.messages.every((m) => m.type !== 'recording-error'),
      JSON.stringify(fifth.messages),
    );
    fifth.ws.close();
    await fifth.closed;
    await sleep(500); // server-side disconnect handling releases the lock
    const locks = await db.query('SELECT * FROM active_recordings WHERE "userId" = $1', [userId]);
    check('no lock rows left after all sessions closed', locks.rows.length === 0, `rows=${locks.rows.length}`);
  }

  // 6. Mid-recording limit: prime usage near the free cap (30/day) and stream.
  {
    await db.query(
      `UPDATE recording_usage SET "creditsUsed" = 28 WHERE "userId" = $1`,
      [userId],
    );
    const c = connect(`/recording?scoreId=${scoreId}`, cookie);
    await c.open;
    await streamAudio(c.ws, audio, 4);
    const limitMsg = c.messages.find((m) => m.type === 'recording-limit');
    check(
      'mid-recording exhaustion → recording-limit message',
      limitMsg?.planId === 'free' && limitMsg?.limitSeconds === 30 && limitMsg?.usedSeconds >= 30,
      JSON.stringify(limitMsg ?? c.messages),
    );
    c.ws.close();
    await c.closed;
    await sleep(300);

    const usage = await db.query(
      'SELECT "creditsUsed" FROM recording_usage WHERE "userId" = $1',
      [userId],
    );
    check(
      'spending stops at the cap (no runaway billing)',
      usage.rows[0].creditsUsed <= 31,
      `used=${usage.rows[0].creditsUsed}`,
    );
  }

  // 7. Already exhausted: refused up front with the limit message.
  {
    const c = connect(`/recording?scoreId=${scoreId}`, cookie);
    await c.open;
    const close = await c.closed;
    check(
      'exhausted budget → recording-limit before any audio',
      c.messages.some((m) => m.type === 'recording-limit') && close.code === 1008,
      JSON.stringify({ close, messages: c.messages }),
    );
  }

  // 8. Pro tier gets the bigger budget: flip the user's subscription row.
  {
    await db.query(
      `INSERT INTO user_subscriptions ("userId", "tierId") VALUES ($1, 'pro')`,
      [userId],
    );
    const c = connect(`/recording?scoreId=${scoreId}`, cookie);
    await c.open;
    await streamAudio(c.ws, audio, 1.5);
    check(
      'pro tier → no limit at 30 credits',
      c.messages.every((m) => m.type !== 'recording-limit') && c.getClose() === null,
      JSON.stringify(c.messages),
    );
    c.ws.close();
    await c.closed;
  }

  // Cleanup the verification user's rows.
  await db.query('DELETE FROM active_recordings WHERE "userId" = $1', [userId]);
  await db.query('DELETE FROM recordings WHERE "userId" = $1', [userId]);
  await db.query('DELETE FROM recording_usage WHERE "userId" = $1', [userId]);
  await db.query('DELETE FROM user_subscriptions WHERE "userId" = $1', [userId]);
  await db.query('DELETE FROM scores WHERE "userId" = $1', [userId]);
  await db.query('DELETE FROM session WHERE "userId" = $1', [userId]);
  await db.query('DELETE FROM account WHERE "userId" = $1', [userId]);
  await db.query('DELETE FROM "user" WHERE id = $1', [userId]);
  await db.end();

  console.log(failures.length ? `\n${failures.length} FAILURE(S)` : '\nALL CHECKS PASSED');
  process.exit(failures.length ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
