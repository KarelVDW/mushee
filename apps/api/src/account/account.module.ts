import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { BillingModule } from '../billing/billing.module';
import { OnboardingModule } from '../onboarding/onboarding.module';
import { RecordingsModule } from '../recordings/recordings.module';
import { ScoresModule } from '../scores/scores.module';
import { SettingsModule } from '../settings/settings.module';
import { SubscriptionsModule } from '../subscriptions/subscriptions.module';
import { AccountController } from './account.controller';
import { AccountService } from './account.service';
import { AccountDeletion } from './entities/account-deletion.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([AccountDeletion]),
    ScoresModule,
    RecordingsModule,
    SubscriptionsModule,
    OnboardingModule,
    SettingsModule,
    BillingModule,
  ],
  controllers: [AccountController],
  providers: [AccountService],
  exports: [AccountService],
})
export class AccountModule {}
