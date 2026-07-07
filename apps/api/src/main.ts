import fastifyCookie from '@fastify/cookie';
import fastifyHelmet from '@fastify/helmet';
import fastifyRateLimit from '@fastify/rate-limit';
import { ConsoleLogger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { WsAdapter } from '@nestjs/platform-ws';
import type { FastifyRequest } from 'fastify';

import { AppModule } from './app.module';
import { seedDemoData } from './database/demo-seed';
import { runMigrationsLocked } from './database/run-migrations';

/** Cap on HTTP request bodies (score JSON). WebSocket audio chunks are
 *  capped separately via `maxPayload` on the recordings gateway. */
const MAX_BODY_BYTES = parseInt(
  process.env.MAX_BODY_BYTES ?? String(5 * 1024 * 1024),
  10,
);

/** Pull the better-auth session token out of the cookie header so the rate
 *  limiter keys per-user where possible, falling back to per-IP. */
function rateLimitKey(req: FastifyRequest): string {
  const cookie = req.headers.cookie ?? '';
  const match = /better-auth\.session_token=([^;]+)/.exec(cookie);
  return match ? `user:${match[1]}` : `ip:${req.ip}`;
}

function parseTrustProxy(
  value: string | undefined,
): boolean | number | string {
  if (!value) return false;
  if (value === 'true') return true;
  const hops = Number(value);
  return Number.isInteger(hops) && hops > 0 ? hops : value;
}

const rateLimitOptions = {
  max: parseInt(process.env.RATE_LIMIT_MAX ?? '120', 10),
  timeWindow: process.env.RATE_LIMIT_WINDOW ?? '1 minute',
  keyGenerator: rateLimitKey,
  // Don't throttle the uptime probe.
  allowList: (req: FastifyRequest) => req.url === '/health',
};

async function bootstrap() {
  // Structured JSON logs in production (queryable in a log aggregator, one
  // object per line); human-readable in dev. LOG_FORMAT=json forces it on.
  const jsonLogs =
    process.env.LOG_FORMAT === 'json' ||
    (process.env.NODE_ENV === 'production' && process.env.LOG_FORMAT !== 'pretty');

  // Before anything connects: bring the schema up to date, exactly once even
  // when many replicas boot together against a fresh database.
  await runMigrationsLocked();

  // rawBody keeps the exact bytes of each JSON body on req.rawBody — Polar
  // webhook signatures (standard-webhooks) are computed over the exact
  // payload, so re-serialized JSON would never verify.
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({
      bodyLimit: MAX_BODY_BYTES,
      // Behind an ingress/LB, req.ip is the proxy unless we trust its
      // forwarding headers — and then per-IP rate limiting throttles the
      // proxy, not clients. TRUST_PROXY takes `true`, a hop count, or a
      // comma-separated address/CIDR list (Fastify semantics). Leave unset
      // for direct-connect dev.
      trustProxy: parseTrustProxy(process.env.TRUST_PROXY),
      // Fastify's pino request logging — one line per request with status,
      // latency, and ip. Off in dev (noise), on wherever logs are structured.
      logger: jsonLogs,
    }),
    { rawBody: true, logger: new ConsoleLogger({ json: jsonLogs }) },
  );

  // Flush SIGTERM through Nest's shutdown hooks so long-lived work (recording
  // sessions, ffmpeg children) drains instead of dying with the pod.
  app.enableShutdownHooks();

  app.useWebSocketAdapter(new WsAdapter(app));

  /* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-argument -- Nest's FastifyAdapter exposes a structurally-distinct Fastify instance type, so plugin refs need casting. */
  await app.register(fastifyCookie as any);
  await app.register(fastifyHelmet as any);
  await app.register(fastifyRateLimit as any, rateLimitOptions);
  /* eslint-enable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-argument */

  app.enableCors({
    origin: process.env.CORS_ORIGIN ?? 'http://localhost:3200',
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  // Local/dev only: provision the demo accounts once migrations have run
  // (module init above), so a fresh stack is usable straight after boot.
  // Never in production — the demo password is public and the main demo
  // account has unlimited recording.
  if (process.env.SEED_DEMO_DATA === 'true') {
    if (process.env.NODE_ENV === 'production') {
      throw new Error(
        'SEED_DEMO_DATA must not be set in production: it creates accounts with a publicly known password',
      );
    }
    await seedDemoData();
  }

  await app.listen(process.env.PORT ?? 4200, '0.0.0.0');
}

void bootstrap();
