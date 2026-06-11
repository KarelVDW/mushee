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

  /** Remove the user's subscription row (account purge). */
  async deleteForUser(userId: string): Promise<void> {
    await this.repo.delete({ userId });
  }
}
