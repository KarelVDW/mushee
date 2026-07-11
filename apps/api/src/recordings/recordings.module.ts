import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { BetaModule } from '../beta/beta.module';
import { ScoresModule } from '../scores/scores.module';
import { StorageModule } from '../storage/storage.module';
import { SubscriptionsModule } from '../subscriptions/subscriptions.module';
import { ActiveRecording } from './entities/active-recording.entity';
import { CreditBalance } from './entities/credit-balance.entity';
import { Recording } from './entities/recording.entity';
import { RecordingUsage } from './entities/recording-usage.entity';
import { RecordingCreditsService } from './recording-credits.service';
import { RecordingLocksService } from './recording-locks.service';
import { RecordingsGateway } from './recordings.gateway';
import { RecordingsService } from './recordings.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Recording, RecordingUsage, ActiveRecording, CreditBalance]),
    SubscriptionsModule,
    ScoresModule,
    BetaModule,
    StorageModule,
  ],
  providers: [
    RecordingsGateway,
    RecordingsService,
    RecordingCreditsService,
    RecordingLocksService,
  ],
  exports: [RecordingsService, RecordingCreditsService],
})
export class RecordingsModule {}
