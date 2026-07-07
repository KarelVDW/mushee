import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';

import { UserSubscription } from './entities/user-subscription.entity';
import { SubscriptionTier } from './SubscriptionTier';

@Injectable()
export class SubscriptionsService {
  constructor(
    @InjectRepository(UserSubscription)
    private readonly repo: Repository<UserSubscription>,
  ) {}

  async tierFor(userId: string): Promise<SubscriptionTier> {
    const subscription = await this.repo.findOneBy({ userId });
    return SubscriptionTier.byId(subscription?.tierId);
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
