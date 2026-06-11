import { Module } from '@nestjs/common';

import { AccountModule } from '../account/account.module';
import { CacheModule } from '../cache/cache.module';
import { ScoresModule } from '../scores/scores.module';
import { StorageModule } from '../storage/storage.module';
import { CronService } from './cron.service';

@Module({
  imports: [AccountModule, CacheModule, ScoresModule, StorageModule],
  providers: [CronService],
})
export class CronModule {}
