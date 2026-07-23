import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AccountModule } from './account/account.module';
import { AdminModule } from './admin/admin.module';
import { AuthModule } from './auth/auth.module';
import { BetaModule } from './beta/beta.module';
import { BillingModule } from './billing/billing.module';
import { CacheModule } from './cache/cache.module';
import { CronModule } from './cron/cron.module';
import { dataSourceOptions } from './database/data-source';
import { HealthController } from './health/health.controller';
import { MailModule } from './mail/mail.module';
import { OnboardingModule } from './onboarding/onboarding.module';
import { RecordingsModule } from './recordings/recordings.module';
import { ScoresModule } from './scores/scores.module';
import { SettingsModule } from './settings/settings.module';
import { StorageModule } from './storage/storage.module';
import { SubscriptionsModule } from './subscriptions/subscriptions.module';

@Module({
  imports: [
    TypeOrmModule.forRoot({
      ...dataSourceOptions,
      autoLoadEntities: true,
      // Schema changes go through migrations (pnpm migration:generate);
      // pending ones run on boot via runMigrationsLocked() in main.ts, which
      // serializes concurrent replicas — not TypeORM's lockless migrationsRun.
    }),
    ScheduleModule.forRoot(),
    MailModule,
    AuthModule,
    AccountModule,
    OnboardingModule,
    ScoresModule,
    SettingsModule,
    CacheModule,
    StorageModule,
    CronModule,
    SubscriptionsModule,
    RecordingsModule,
    BetaModule,
    BillingModule,
    AdminModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
