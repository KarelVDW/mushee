import { IsIn } from 'class-validator';

import type { BillingInterval, PaidTierId } from '../polar-products';
import { BILLING_INTERVALS, PAID_TIER_IDS } from '../polar-products';

export class CreateCheckoutDto {
  @IsIn(PAID_TIER_IDS)
  tierId: PaidTierId;

  @IsIn(BILLING_INTERVALS)
  interval: BillingInterval;
}
