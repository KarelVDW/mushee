import { Injectable, Logger } from '@nestjs/common'
import { Cron, CronExpression } from '@nestjs/schedule'
import { InjectDataSource } from '@nestjs/typeorm'
import { DataSource } from 'typeorm'

import { AccountService } from '../account/account.service'
import { PolarWebhookService } from '../billing/polar-webhook.service'
import { ScoresService } from '../scores/scores.service'

/** Advisory-lock keys: one per job, distinct from the migration lock (727271). */
const LOCK_PURGE_ACCOUNTS = 727273
const LOCK_FLUSH_SCORES = 727274
const LOCK_PRUNE_WEBHOOKS = 727275

/**
 * The API's schedule table: when each maintenance job runs, single-flighted
 * across replicas. The work itself lives with the module that owns the data.
 */
@Injectable()
export class CronService {
    private readonly logger = new Logger(CronService.name)

    constructor(
        @InjectDataSource() private readonly dataSource: DataSource,
        private readonly accountService: AccountService,
        private readonly scoresService: ScoresService,
        private readonly polarWebhookService: PolarWebhookService,
    ) {}

    /**
     * Single-flight a cron job across replicas: every replica fires on schedule,
     * but only the one that wins the try-lock does the work. Lock and unlock
     * must share one session, hence the pinned QueryRunner.
     */
    private async withCronLock(key: number, fn: () => Promise<void>): Promise<void> {
        const runner = this.dataSource.createQueryRunner()
        try {
            const rows = (await runner.query('SELECT pg_try_advisory_lock($1) AS locked', [key])) as Array<{ locked: boolean }>
            if (!rows[0]?.locked) return
            try {
                await fn()
            } finally {
                await runner.query('SELECT pg_advisory_unlock($1)', [key]).catch(() => {})
            }
        } finally {
            await runner.release().catch(() => {})
        }
    }

    /**
     * Permanently delete accounts whose 7-day deletion grace period has
     * passed. Hourly, so a purge lands close to the promised moment.
     */
    @Cron(CronExpression.EVERY_HOUR)
    async purgeDeletedAccounts(): Promise<void> {
        await this.withCronLock(LOCK_PURGE_ACCOUNTS, async () => {
            const purged = await this.accountService.purgeExpired()
            if (purged > 0) {
                this.logger.log(`Purged ${purged} account(s) past their grace period`)
            }
        })
    }

    @Cron(CronExpression.EVERY_DAY_AT_4AM)
    async pruneProcessedWebhookEvents(): Promise<void> {
        await this.withCronLock(LOCK_PRUNE_WEBHOOKS, () => this.polarWebhookService.pruneProcessedWebhookEvents(90))
    }

    /** Every 10 minutes, write scores left idle in the edit cache for 10 minutes back to storage. */
    @Cron(CronExpression.EVERY_10_MINUTES)
    async flushStaleScores(): Promise<void> {
        await this.withCronLock(LOCK_FLUSH_SCORES, async () => {
            const flushed = await this.scoresService.flushIdleDocuments(10)
            if (flushed > 0) {
                this.logger.log(`Flushed ${flushed} idle score(s) to storage`)
            }
        })
    }
}
