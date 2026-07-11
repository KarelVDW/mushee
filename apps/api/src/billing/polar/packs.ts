/**
 * One-time recording-minute packs, sold as Polar one-time products. A pack
 * grants a fixed number of seconds to `credit_balances`; the seconds never
 * expire and are only drawn from once the day's subscription budget is spent.
 *
 * Deliberately priced well above the subscriptions' effective per-minute rate
 * — packs serve the occasional user, plans stay the obvious deal. Configure
 * the product ids from the Polar dashboard:
 *
 *   POLAR_PRODUCT_PACK_SINGLE / POLAR_PRODUCT_PACK_EP / POLAR_PRODUCT_PACK_ALBUM
 *
 * Unset ids make that pack unavailable for checkout (graceful degradation,
 * same contract as the subscription products).
 */

export type PackId = 'single' | 'ep' | 'album';

export const PACK_IDS: PackId[] = ['single', 'ep', 'album'];

/** Seconds of recording each pack grants. */
export const PACK_SECONDS: Record<PackId, number> = {
  single: 15 * 60,
  ep: 45 * 60,
  album: 150 * 60,
};

function envKey(packId: PackId): string {
  return `POLAR_PRODUCT_PACK_${packId.toUpperCase()}`;
}

export function productIdForPack(
  packId: PackId,
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  return env[envKey(packId)]?.trim() || null;
}

/** Reverse lookup: which pack does a Polar product id sell? Null for
 *  subscription products and unknown ids — order webhooks use this to tell
 *  pack purchases apart from subscription invoices. */
export function packForProduct(
  productId: string | null | undefined,
  env: NodeJS.ProcessEnv = process.env,
): PackId | null {
  if (!productId) return null;
  for (const packId of PACK_IDS) {
    if (productIdForPack(packId, env) === productId) return packId;
  }
  return null;
}

export function isPackId(id: string): id is PackId {
  return (PACK_IDS as string[]).includes(id);
}
