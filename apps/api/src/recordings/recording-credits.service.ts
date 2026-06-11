import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { SubscriptionsService } from '../subscriptions/subscriptions.service';
import { SubscriptionTier } from '../subscriptions/SubscriptionTier';
import { RecordingUsage } from './entities/recording-usage.entity';

export interface RecordingCreditBalance {
  tier: SubscriptionTier;
  /** Credits spent today (1 credit = 1 second of recording). */
  used: number;
  /** Credits left today; `null` when the tier has unlimited recording. */
  remaining: number | null;
  exhausted: boolean;
}

/**
 * Tracks daily recording credits per user. Budgets come from the user's
 * subscription tier and reset at midnight UTC (a new `recording_usage` row
 * per day — no reset job needed).
 */
@Injectable()
export class RecordingCreditsService {
  constructor(
    @InjectRepository(RecordingUsage)
    private readonly usageRepo: Repository<RecordingUsage>,
    private readonly subscriptions: SubscriptionsService,
  ) {}

  async balance(userId: string): Promise<RecordingCreditBalance> {
    const tier = await this.subscriptions.tierFor(userId);
    const usage = await this.usageRepo.findOneBy({
      userId,
      day: this.today(),
    });
    return this.toBalance(tier, usage?.creditsUsed ?? 0);
  }

  /**
   * Atomically spend credits against today's budget and return the new
   * balance. Usage is recorded even on unlimited tiers (it never exhausts).
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
    return this.toBalance(tier, rows[0].creditsUsed);
  }

  private toBalance(
    tier: SubscriptionTier,
    used: number,
  ): RecordingCreditBalance {
    const limit = tier.dailyRecordingCredits;
    const remaining = limit === null ? null : Math.max(0, limit - used);
    return { tier, used, remaining, exhausted: remaining === 0 };
  }

  private today(): string {
    return new Date().toISOString().slice(0, 10);
  }
}
