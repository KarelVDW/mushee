import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { CacheService } from './cache.service';
import { CachedScore } from './entities/cached-score.entity';

@Module({
  imports: [TypeOrmModule.forFeature([CachedScore])],
  providers: [CacheService],
  exports: [CacheService],
})
export class CacheModule {}
