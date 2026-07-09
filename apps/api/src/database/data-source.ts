import 'reflect-metadata';

import { DataSource, DataSourceOptions } from 'typeorm';

import { AccountDeletion } from '../account/entities/account-deletion.entity';
import { ProcessedWebhookEvent } from '../billing/entities/processed-webhook-event.entity';
import { CachedScore } from '../cache/entities/cached-score.entity';
import { UserOnboarding } from '../onboarding/entities/user-onboarding.entity';
import { ActiveRecording } from '../recordings/entities/active-recording.entity';
import { Recording } from '../recordings/entities/recording.entity';
import { RecordingUsage } from '../recordings/entities/recording-usage.entity';
import { Score } from '../scores/entities/score.entity';
import { UserSettings } from '../settings/entities/user-settings.entity';
import { SubscriptionTier } from '../subscriptions/entities/subscription-tier.entity';
import { UserSubscription } from '../subscriptions/entities/user-subscription.entity';
import { migrations } from './migrations';
import { postgresSsl } from './postgres-ssl';

/**
 * Single source of truth for the Postgres connection, shared by the Nest app
 * (app.module.ts) and the TypeORM CLI (pnpm migration:*). Entities and
 * migrations are imported explicitly — no globs — so the same options work
 * from both ts (CLI via tsx) and compiled dist (production).
 *
 * Note: better-auth manages its own tables through a separate pg.Pool, but
 * its schema is snapshotted into these migrations (BetterAuthSchema) so boot
 * alone fully provisions a fresh database.
 */
// The mushee:mushee@localhost fallbacks below exist for local dev only; a
// production pod that reaches them is misconfigured (Secret not mounted) and
// must not sit in a crash-loop of connection errors that looks like a DB
// outage.
if (process.env.NODE_ENV === 'production' && !process.env.POSTGRES_URL && !process.env.POSTGRES_PASSWORD) {
  throw new Error(
    'POSTGRES_URL or POSTGRES_PASSWORD must be set in production — refusing to fall back to the local dev credentials.',
  );
}

export const dataSourceOptions: DataSourceOptions = {
  type: 'postgres',
  // POSTGRES_URL wins when set — better-auth and the seeder already read it,
  // so TypeORM must too or the two halves of the app connect to different
  // databases.
  ...(process.env.POSTGRES_URL
    ? { url: process.env.POSTGRES_URL }
    : {
        host: process.env.POSTGRES_HOST ?? 'localhost',
        port: parseInt(process.env.POSTGRES_PORT ?? '5632', 10),
        username: process.env.POSTGRES_USER ?? 'mushee',
        password: process.env.POSTGRES_PASSWORD ?? 'mushee',
        database: process.env.POSTGRES_DB ?? 'mushee',
      }),
  ssl: postgresSsl(),
  // Per-replica pool cap; two pools run per replica (TypeORM + better-auth),
  // so size against the server's max_connections before scaling replicas.
  extra: { max: parseInt(process.env.POSTGRES_POOL_SIZE ?? '10', 10) },
  entities: [
    AccountDeletion,
    ActiveRecording,
    CachedScore,
    ProcessedWebhookEvent,
    Recording,
    RecordingUsage,
    Score,
    SubscriptionTier,
    UserOnboarding,
    UserSettings,
    UserSubscription,
  ],
  migrations,
  synchronize: false,
};

export default new DataSource(dataSourceOptions);
