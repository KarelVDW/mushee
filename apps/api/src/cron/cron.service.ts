import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';

import { CacheService } from '../cache/cache.service';
import { ScoresService } from '../scores/scores.service';
import { StorageService } from '../storage/storage.service';

@Injectable()
export class CronService {
  private readonly logger = new Logger(CronService.name);

  constructor(
    private readonly cacheService: CacheService,
    private readonly scoresService: ScoresService,
    private readonly storageService: StorageService,
  ) {}

  /**
   * Every 10 minutes, find cached scores that haven't been updated
   * in the last 10 minutes. Convert them to MusicXML, write to storage,
   * and remove from MongoDB cache.
   */
  @Cron(CronExpression.EVERY_10_MINUTES)
  async flushStaleScores(): Promise<void> {
    this.logger.log('Checking for stale cached scores...');

    const staleScores = await this.cacheService.findStale(10);

    if (staleScores.length === 0) {
      this.logger.log('No stale scores found');
      return;
    }

    this.logger.log(`Found ${staleScores.length} stale score(s) to flush`);

    for (const cached of staleScores) {
      try {
        const score = await this.scoresService.findOneInternal(cached.scoreId);
        if (!score) {
          this.logger.warn(
            `Score ${cached.scoreId} not found in DB, removing from cache`,
          );
          await this.cacheService.deleteByScoreId(cached.scoreId);
          continue;
        }

        const musicxml = this.scoresService.jsonToMusicxml(cached.data);
        await this.storageService.write(score.storageKey, musicxml);
        await this.cacheService.deleteByScoreId(cached.scoreId);

        this.logger.log(`Flushed score ${score.id} (${score.title}) to storage`);
      } catch (error) {
        this.logger.error(
          `Failed to flush score ${cached.scoreId}: ${error}`,
        );
      }
    }
  }
}
