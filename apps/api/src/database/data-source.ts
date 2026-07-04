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
import { UserSubscription } from '../subscriptions/entities/user-subscription.entity';
import { migrations } from './migrations';

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
export const dataSourceOptions: DataSourceOptions = {
  type: 'postgres',
  host: process.env.POSTGRES_HOST ?? 'localhost',
  port: parseInt(process.env.POSTGRES_PORT ?? '5632', 10),
  username: process.env.POSTGRES_USER ?? 'mushee',
  password: process.env.POSTGRES_PASSWORD ?? 'mushee',
  database: process.env.POSTGRES_DB ?? 'mushee',
  entities: [
    AccountDeletion,
    ActiveRecording,
    CachedScore,
    ProcessedWebhookEvent,
    Recording,
    RecordingUsage,
    Score,
    UserOnboarding,
    UserSubscription,
  ],
  migrations,
  synchronize: false,
};

export default new DataSource(dataSourceOptions);
