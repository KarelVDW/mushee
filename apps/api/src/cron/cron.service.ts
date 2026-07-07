import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

import { AccountService } from '../account/account.service';
import { CacheService } from '../cache/cache.service';
import { ScoresService } from '../scores/scores.service';
import { StorageService } from '../storage/storage.service';

/** Advisory-lock keys: one per job, distinct from the migration lock (727271). */
const LOCK_PURGE_ACCOUNTS = 727273;
const LOCK_FLUSH_SCORES = 727274;
const LOCK_PRUNE_WEBHOOKS = 727275;

@Injectable()
export class CronService {
  private readonly logger = new Logger(CronService.name);

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly accountService: AccountService,
    private readonly cacheService: CacheService,
    private readonly scoresService: ScoresService,
    private readonly storageService: StorageService,
  ) {}

  /**
   * Single-flight a cron job across replicas: every replica fires on schedule,
   * but only the one that wins the try-lock does the work. Lock and unlock
   * must share one session, hence the pinned QueryRunner.
   */
  private async withCronLock(key: number, fn: () => Promise<void>): Promise<void> {
    const runner = this.dataSource.createQueryRunner();
    try {
      const rows = (await runner.query(
        'SELECT pg_try_advisory_lock($1) AS locked',
        [key],
      )) as Array<{ locked: boolean }>;
      if (!rows[0]?.locked) return;
      try {
        await fn();
      } finally {
        await runner.query('SELECT pg_advisory_unlock($1)', [key]).catch(() => {});
      }
    } finally {
      await runner.release().catch(() => {});
    }
  }

  /**
   * Permanently delete accounts whose 7-day deletion grace period has
   * passed. Hourly, so a purge lands close to the promised moment.
   */
  @Cron(CronExpression.EVERY_HOUR)
  async purgeDeletedAccounts(): Promise<void> {
    await this.withCronLock(LOCK_PURGE_ACCOUNTS, async () => {
      const purged = await this.accountService.purgeExpired();
      if (purged > 0) {
        this.logger.log(`Purged ${purged} account(s) past their grace period`);
      }
    });
  }

  /**
   * Webhook delivery ids only need to live as long as Polar retries a
   * delivery (days); prune old ones so the table doesn't grow forever.
   */
  @Cron(CronExpression.EVERY_DAY_AT_4AM)
  async pruneProcessedWebhookEvents(): Promise<void> {
    await this.withCronLock(LOCK_PRUNE_WEBHOOKS, async () => {
      await this.dataSource.query(
        `DELETE FROM processed_webhook_events WHERE "receivedAt" < now() - interval '90 days'`,
      );
    });
  }

  /**
   * Every 10 minutes, find cached scores that haven't been updated
   * in the last 10 minutes. Convert them to MusicXML, write to storage,
   * and remove from the edit cache.
   */
  @Cron(CronExpression.EVERY_10_MINUTES)
  async flushStaleScores(): Promise<void> {
    await this.withCronLock(LOCK_FLUSH_SCORES, () => this.flushStaleScoresLocked());
  }

  private async flushStaleScoresLocked(): Promise<void> {
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
        await this.cacheService.deleteIfNotUpdatedSince(
          cached.scoreId,
          cached.updatedAt,
        );

        this.logger.log(`Flushed score ${score.id} (${score.title}) to storage`);
      } catch (error) {
        this.logger.error(
          `Failed to flush score ${cached.scoreId}: ${String(error)}`,
        );
      }
    }
  }
}
