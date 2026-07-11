import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';

import { SubscriptionTier } from '../subscriptions/entities/subscription-tier.entity';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';
import { CreditBalance } from './entities/credit-balance.entity';
import { RecordingUsage } from './entities/recording-usage.entity';

export interface RecordingCreditBalance {
  tier: SubscriptionTier;
  /** Credits spent today (1 credit = 1 second of recording). */
  used: number;
  /** Credits left today; `null` when the tier has unlimited recording. */
  remaining: number | null;
  /**
   * Purchased pack seconds still available. Authoritative in `balance()`;
   * `spend()` only consults it once the daily budget is spent (the meter runs
   * every second and must not add a query per tick before then), so a spend
   * result reads 0 while the daily budget still covers the take.
   */
  packSeconds: number;
  /** No daily budget left AND no purchased seconds to fall back on. */
  exhausted: boolean;
}

/**
 * Tracks recording credits per user across two pools:
 *
 * - The daily budget from the subscription tier, reset at midnight UTC
 *   (a new `recording_usage` row per day — no reset job needed).
 * - Purchased one-time pack seconds (`credit_balances`), which never expire
 *   and are drawn from only after the day's budget is spent.
 */
@Injectable()
export class RecordingCreditsService {
  constructor(
    @InjectRepository(RecordingUsage)
    private readonly usageRepo: Repository<RecordingUsage>,
    @InjectRepository(CreditBalance)
    private readonly balanceRepo: Repository<CreditBalance>,
    private readonly subscriptions: SubscriptionsService,
  ) {}

  async balance(userId: string): Promise<RecordingCreditBalance> {
    const tier = await this.subscriptions.tierFor(userId);
    const usage = await this.usageRepo.findOneBy({
      userId,
      day: this.today(),
    });
    const packSeconds = await this.packSecondsOf(userId);
    return this.toBalance(tier, usage?.creditsUsed ?? 0, packSeconds);
  }

  /**
   * Atomically spend credits and return the new balance. The daily budget is
   * always billed first; whatever a tick spends beyond it is drawn from the
   * purchased pack balance. Usage is recorded even on unlimited tiers (it
   * never exhausts) and keeps counting past the budget while packs last, so
   * `recording_usage` stays the full "seconds recorded today" record.
   */
  async spend(userId: string, credits: number): Promise<RecordingCreditBalance> {
    const tier = await this.subscriptions.tierFor(userId);
    const rows: Array<{ creditsUsed: number }> = await this.usageRepo.query(
      `INSERT INTO recording_usage ("userId", day, "creditsUsed")
       VALUES ($1, $2, $3)
       ON CONFLICT ("userId", day)
       DO UPDATE SET "creditsUsed" = recording_usage."creditsUsed" + EXCLUDED."creditsUsed"
       RETURNING "creditsUsed"`,
      [userId, this.today(), credits],
    );
    const used = rows[0].creditsUsed;

    const limit = tier.dailyRecordingCredits;
    let packSeconds = 0;
    if (limit !== null && used >= limit) {
      // The slice of THIS tick that fell beyond the daily budget (the first
      // tick past the boundary is usually only partially beyond it).
      const overflow = used - limit - Math.max(0, used - credits - limit);
      packSeconds =
        overflow > 0
          ? await this.drawPackSeconds(userId, overflow)
          : await this.packSecondsOf(userId);
    }
    return this.toBalance(tier, used, packSeconds);
  }

  /**
   * Add purchased pack seconds (Polar `order.paid`). Runs in the webhook's
   * transaction so a failed grant rolls back with its dedup row and Polar
   * retries cleanly.
   */
  async grantPackSeconds(
    userId: string,
    seconds: number,
    manager?: EntityManager,
  ): Promise<void> {
    const repo = manager?.getRepository(CreditBalance) ?? this.balanceRepo;
    await repo.query(
      `INSERT INTO credit_balances ("userId", seconds)
       VALUES ($1, $2)
       ON CONFLICT ("userId")
       DO UPDATE SET seconds = credit_balances.seconds + EXCLUDED.seconds,
                     "updatedAt" = now()`,
      [userId, seconds],
    );
  }

  /**
   * Remove pack seconds (Polar refund). Clamped at zero — a refunded pack
   * that was already partly recorded with can't go negative.
   */
  async revokePackSeconds(
    userId: string,
    seconds: number,
    manager?: EntityManager,
  ): Promise<void> {
    const repo = manager?.getRepository(CreditBalance) ?? this.balanceRepo;
    await repo.query(
      `UPDATE credit_balances
       SET seconds = GREATEST(seconds - $2, 0), "updatedAt" = now()
       WHERE "userId" = $1`,
      [userId, seconds],
    );
  }

  /** Remove all usage rows and the pack balance for a user (account purge). */
  async deleteAllForUser(userId: string): Promise<void> {
    await this.usageRepo.delete({ userId });
    await this.balanceRepo.delete({ userId });
  }

  /** Atomically draw up to `seconds` from the pack balance; returns what is
   *  left. Clamped at zero — the final tick may be only partly covered, the
   *  same one-tick overshoot the daily budget already tolerates. */
  private async drawPackSeconds(
    userId: string,
    seconds: number,
  ): Promise<number> {
    const rows: Array<{ seconds: number }> = await this.balanceRepo.query(
      `UPDATE credit_balances
       SET seconds = GREATEST(seconds - $2, 0), "updatedAt" = now()
       WHERE "userId" = $1
       RETURNING seconds`,
      [userId, seconds],
    );
    return rows[0]?.seconds ?? 0;
  }

  private async packSecondsOf(userId: string): Promise<number> {
    const row = await this.balanceRepo.findOneBy({ userId });
    return row?.seconds ?? 0;
  }

  private toBalance(
    tier: SubscriptionTier,
    used: number,
    packSeconds: number,
  ): RecordingCreditBalance {
    const limit = tier.dailyRecordingCredits;
    const remaining = limit === null ? null : Math.max(0, limit - used);
    return {
      tier,
      used,
      remaining,
      packSeconds,
      exhausted: remaining === 0 && packSeconds === 0,
    };
  }

  private today(): string {
    return new Date().toISOString().slice(0, 10);
  }
}
