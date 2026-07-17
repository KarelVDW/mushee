import { Controller, Get } from '@nestjs/common';

import { SubscriptionsService } from './subscriptions.service';

/**
 * Public tier catalogue: what each plan is entitled to, straight from the
 * database. The web app's in-app surfaces (onboarding, settings, upgrade
 * dialogs) read this; only the marketing landing page keeps a static copy.
 * No auth — it's the same information the pricing page shows the world.
 */
@Controller('plans')
export class PlansController {
  constructor(private readonly subscriptions: SubscriptionsService) {}

  @Get()
  async list() {
    const tiers = await this.subscriptions.allTiers();
    return tiers.map((tier) => ({
      id: tier.id,
      name: tier.name,
      dailyRecordingCredits: tier.dailyRecordingCredits,
      maxScores: tier.maxScores,
      sellable: tier.sellable,
    }));
  }
}
