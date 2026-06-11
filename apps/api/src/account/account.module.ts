import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { OnboardingModule } from '../onboarding/onboarding.module';
import { RecordingsModule } from '../recordings/recordings.module';
import { ScoresModule } from '../scores/scores.module';
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
  ],
  controllers: [AccountController],
  providers: [AccountService],
  exports: [AccountService],
})
export class AccountModule {}
