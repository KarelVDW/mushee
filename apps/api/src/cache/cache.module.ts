import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';

import { CacheService } from './cache.service';
import { CachedScore, CachedScoreSchema } from './cached-score.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: CachedScore.name, schema: CachedScoreSchema },
    ]),
  ],
  providers: [CacheService],
  exports: [CacheService],
})
export class CacheModule {}
