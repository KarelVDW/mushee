import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';

import { SubscriptionTier } from './entities/subscription-tier.entity';
import { UserSubscription } from './entities/user-subscription.entity';

/**
 * How long the tier catalogue is served from memory. Tier lookups run on the
 * recording hot path (once per second per live take), so they must not hit
 * the database each time; one minute still makes production re-tuning of a
 * tier's budget take effect quickly.
 */
const TIER_CACHE_TTL_MS = 60_000;

@Injectable()
export class SubscriptionsService {
  private tierCache: { at: number; byId: Map<string, SubscriptionTier> } | null =
    null;

  constructor(
    @InjectRepository(UserSubscription)
    private readonly repo: Repository<UserSubscription>,
    @InjectRepository(SubscriptionTier)
    private readonly tiers: Repository<SubscriptionTier>,
  ) {}

  /** All tiers, in picker order. Cached (see TIER_CACHE_TTL_MS). */
  async allTiers(): Promise<SubscriptionTier[]> {
    return [...(await this.tierMap()).values()];
  }

  /**
   * Look up a tier by id. Unknown/legacy ids fall back to the free tier
   * rather than throwing — a stale `user_subscriptions.tierId` must degrade
   * a user's budget, never break their account.
   */
  async tierById(id: string | null | undefined): Promise<SubscriptionTier> {
    const byId = await this.tierMap();
    const tier = (id && byId.get(id)) || byId.get('free');
    if (!tier) {
      throw new Error(
        'Subscription tier catalogue is empty — has the seed migration run?',
      );
    }
    return tier;
  }

  async tierFor(userId: string): Promise<SubscriptionTier> {
    const subscription = await this.repo.findOneBy({ userId });
    return this.tierById(subscription?.tierId);
  }

  private async tierMap(): Promise<Map<string, SubscriptionTier>> {
    const now = Date.now();
    if (!this.tierCache || now - this.tierCache.at > TIER_CACHE_TTL_MS) {
      const rows = await this.tiers.find({ order: { sortOrder: 'ASC' } });
      this.tierCache = { at: now, byId: new Map(rows.map((t) => [t.id, t])) };
    }
    return this.tierCache.byId;
  }

  async findForUser(
    userId: string,
    manager?: EntityManager,
  ): Promise<UserSubscription | null> {
    const repo = manager?.getRepository(UserSubscription) ?? this.repo;
    return repo.findOneBy({ userId });
  }

  /**
   * Create or update the user's subscription row. Used by the beta signup
   * hook (tier 'beta') and by the Polar webhook handler (paid tiers).
   *
   * A single INSERT … ON CONFLICT DO UPDATE — concurrent webhook deliveries
   * for a user with no row must not race into a duplicate-key error. Pass
   * `manager` to run inside a caller's transaction.
   */
  async upsert(
    userId: string,
    changes: Partial<Omit<UserSubscription, 'userId' | 'createdAt' | 'updatedAt'>>,
    manager?: EntityManager,
  ): Promise<UserSubscription> {
    const repo = manager?.getRepository(UserSubscription) ?? this.repo;
    const columns = Object.keys(changes);
    if (columns.length) {
      await repo
        .createQueryBuilder()
        .insert()
        .values({ userId, ...changes, updatedAt: () => 'now()' })
        .orUpdate([...columns, 'updatedAt'], ['userId'])
        .execute();
    }
    const row = await repo.findOneBy({ userId });
    if (!row) {
      throw new Error(`Subscription upsert failed for user ${userId}`);
    }
    return row;
  }

  /** Remove the user's subscription row (account purge). */
  async deleteForUser(userId: string): Promise<void> {
    await this.repo.delete({ userId });
  }
}
