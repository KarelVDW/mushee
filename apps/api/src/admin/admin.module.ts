import { Module } from '@nestjs/common';

import { RecordingsModule } from '../recordings/recordings.module';
import { ScoresModule } from '../scores/scores.module';
import { StorageModule } from '../storage/storage.module';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';

@Module({
  imports: [ScoresModule, RecordingsModule, StorageModule],
  controllers: [AdminController],
  providers: [AdminService],
})
export class AdminModule {}
