import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

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

  async findForUser(userId: string): Promise<UserSubscription | null> {
    return this.repo.findOneBy({ userId });
  }

  /**
   * Create or update the user's subscription row. Used by the beta signup
   * hook (tier 'beta') and by the Polar webhook handler (paid tiers).
   */
  async upsert(
    userId: string,
    changes: Partial<Omit<UserSubscription, 'userId' | 'createdAt' | 'updatedAt'>>,
  ): Promise<UserSubscription> {
    const existing = await this.repo.findOneBy({ userId });
    const row = existing
      ? this.repo.merge(existing, changes)
      : this.repo.create({ userId, ...changes });
    return this.repo.save(row);
  }

  /** Remove the user's subscription row (account purge). */
  async deleteForUser(userId: string): Promise<void> {
    await this.repo.delete({ userId });
  }
}
