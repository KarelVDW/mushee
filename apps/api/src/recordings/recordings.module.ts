import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { ScoresModule } from '../scores/scores.module';
import { SubscriptionsModule } from '../subscriptions/subscriptions.module';
import { ActiveRecording } from './entities/active-recording.entity';
import { Recording } from './entities/recording.entity';
import { RecordingUsage } from './entities/recording-usage.entity';
import { RecordingCreditsService } from './recording-credits.service';
import { RecordingLocksService } from './recording-locks.service';
import { RecordingsGateway } from './recordings.gateway';
import { RecordingsService } from './recordings.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Recording, RecordingUsage, ActiveRecording]),
    SubscriptionsModule,
    ScoresModule,
  ],
  providers: [
    RecordingsGateway,
    RecordingsService,
    RecordingCreditsService,
    RecordingLocksService,
  ],
  exports: [RecordingsService],
})
export class RecordingsModule {}
