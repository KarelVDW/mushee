import fastifyCookie from '@fastify/cookie';
import fastifyHelmet from '@fastify/helmet';
import fastifyRateLimit from '@fastify/rate-limit';
import { ValidationPipe } from '@nestjs/common';
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

const rateLimitOptions = {
  max: parseInt(process.env.RATE_LIMIT_MAX ?? '120', 10),
  timeWindow: process.env.RATE_LIMIT_WINDOW ?? '1 minute',
  keyGenerator: rateLimitKey,
  // Don't throttle the uptime probe.
  allowList: (req: FastifyRequest) => req.url === '/health',
};

async function bootstrap() {
  // Before anything connects: bring the schema up to date, exactly once even
  // when many replicas boot together against a fresh database.
  await runMigrationsLocked();

  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({ bodyLimit: MAX_BODY_BYTES }),
  );

  app.useWebSocketAdapter(new WsAdapter(app));

  // Replace the JSON body parser with one that keeps the raw bytes on
  // req.rawBody — Polar webhook signatures (standard-webhooks) are computed
  // over the exact payload, so re-serialized JSON would never verify.
  // Parsing still goes through fastify's own secure JSON parser.
  const fastify = app.getHttpAdapter().getInstance();
  const parseJson = fastify.getDefaultJsonParser('error', 'error');
  fastify.addContentTypeParser(
    'application/json',
    { parseAs: 'buffer' },
    (req, body: Buffer, done) => {
      (req as unknown as { rawBody: Buffer }).rawBody = body;
      void parseJson(req, body.toString('utf8'), done);
    },
  );

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
  if (process.env.SEED_DEMO_DATA === 'true') {
    await seedDemoData();
  }

  await app.listen(process.env.PORT ?? 4200, '0.0.0.0');
}

void bootstrap();
