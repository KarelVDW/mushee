import { Module } from '@nestjs/common';

import { RecordingsGateway } from './recordings.gateway';
import { RecordingsService } from './recordings.service';

@Module({
  providers: [RecordingsGateway, RecordingsService],
})
export class RecordingsModule {}
