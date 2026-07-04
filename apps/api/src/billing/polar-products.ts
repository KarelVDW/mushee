/**
 * Maps Sheemu subscription tiers to Polar product ids. Each paid tier ×
 * billing interval is one Polar product (Polar models monthly and yearly
 * prices as separate products). Configure the ids from the Polar dashboard:
 *
 *   POLAR_PRODUCT_PRO_MONTHLY / POLAR_PRODUCT_PRO_YEARLY
 *   POLAR_PRODUCT_STUDIO_MONTHLY / POLAR_PRODUCT_STUDIO_YEARLY
 *
 * Unset ids simply make that tier/interval unavailable for checkout, so a
 * partially configured environment degrades gracefully.
 */

export type PaidTierId = 'pro' | 'studio';
export type BillingInterval = 'monthly' | 'yearly';

export const PAID_TIER_IDS: PaidTierId[] = ['pro', 'studio'];
export const BILLING_INTERVALS: BillingInterval[] = ['monthly', 'yearly'];

function envKey(tierId: PaidTierId, interval: BillingInterval): string {
  return `POLAR_PRODUCT_${tierId.toUpperCase()}_${interval.toUpperCase()}`;
}

export function productIdFor(
  tierId: PaidTierId,
  interval: BillingInterval,
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  return env[envKey(tierId, interval)]?.trim() || null;
}

/** Reverse lookup: which tier does a Polar product id belong to? */
export function tierForProduct(
  productId: string,
  env: NodeJS.ProcessEnv = process.env,
): PaidTierId | null {
  for (const tierId of PAID_TIER_IDS) {
    for (const interval of BILLING_INTERVALS) {
      if (productIdFor(tierId, interval, env) === productId) return tierId;
    }
  }
  return null;
}

/** Reverse lookup: which billing interval does a Polar product id sell? */
export function intervalForProduct(
  productId: string | null | undefined,
  env: NodeJS.ProcessEnv = process.env,
): BillingInterval | null {
  if (!productId) return null;
  for (const tierId of PAID_TIER_IDS) {
    for (const interval of BILLING_INTERVALS) {
      if (productIdFor(tierId, interval, env) === productId) return interval;
    }
  }
  return null;
}

export function isPaidTierId(id: string): id is PaidTierId {
  return (PAID_TIER_IDS as string[]).includes(id);
}

export function isBillingInterval(v: string): v is BillingInterval {
  return (BILLING_INTERVALS as string[]).includes(v);
}
