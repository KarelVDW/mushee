import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AccountModule } from './account/account.module';
import { AuthModule } from './auth/auth.module';
import { CacheModule } from './cache/cache.module';
import { CronModule } from './cron/cron.module';
import { dataSourceOptions } from './database/data-source';
import { HealthController } from './health.controller';
import { MailModule } from './mail/mail.module';
import { OnboardingModule } from './onboarding/onboarding.module';
import { RecordingsModule } from './recordings/recordings.module';
import { ScoresModule } from './scores/scores.module';
import { StorageModule } from './storage/storage.module';
import { SubscriptionsModule } from './subscriptions/subscriptions.module';

@Module({
  imports: [
    TypeOrmModule.forRoot({
      ...dataSourceOptions,
      autoLoadEntities: true,
      // Schema changes go through migrations (pnpm migration:generate);
      // pending ones run automatically on boot.
      migrationsRun: true,
    }),
    ScheduleModule.forRoot(),
    MailModule,
    AuthModule,
    AccountModule,
    OnboardingModule,
    ScoresModule,
    CacheModule,
    StorageModule,
    CronModule,
    SubscriptionsModule,
    RecordingsModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
