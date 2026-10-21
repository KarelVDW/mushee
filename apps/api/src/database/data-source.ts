import 'reflect-metadata'

import { DataSource, DataSourceOptions } from 'typeorm'

import { AccountDeletion } from '../account/entities/account-deletion.entity'
import { ProcessedWebhookEvent } from '../billing/entities/processed-webhook-event.entity'
import { UserOnboarding } from '../onboarding/entities/user-onboarding.entity'
import { ActiveRecording } from '../recordings/entities/active-recording.entity'
import { CreditBalance } from '../recordings/entities/credit-balance.entity'
import { Recording } from '../recordings/entities/recording.entity'
import { RecordingUsage } from '../recordings/entities/recording-usage.entity'
import { CachedScore } from '../scores/entities/cached-score.entity'
import { Score } from '../scores/entities/score.entity'
import { UserSettings } from '../settings/entities/user-settings.entity'
import { SubscriptionTier } from '../subscriptions/entities/subscription-tier.entity'
import { UserSubscription } from '../subscriptions/entities/user-subscription.entity'
import { migrations } from './migrations'
import { postgresSsl, postgresUrl } from './postgres-connection'

/**
 * Single source of truth for the TypeORM data source, shared by the Nest app
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
    // Same URL and TLS as better-auth's pool and the seeder (postgres-connection.ts).
    url: postgresUrl(),
    ssl: postgresSsl(),
    // Per-replica pool cap; two pools run per replica (TypeORM + better-auth),
    // so size against the server's max_connections before scaling replicas.
    extra: { max: parseInt(process.env.POSTGRES_POOL_SIZE ?? '10', 10) },
    entities: [
        AccountDeletion,
        ActiveRecording,
        CachedScore,
        CreditBalance,
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
}

export default new DataSource(dataSourceOptions)
