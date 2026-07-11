import { describe, expect, it } from 'vitest';

import {
  intervalForProduct,
  isBillingInterval,
  isPaidTierId,
  productIdFor,
  tierForProduct,
} from '../../../src/billing/polar/products';

const env = {
  POLAR_PRODUCT_PRO_MONTHLY: 'prod-pro-m',
  POLAR_PRODUCT_PRO_YEARLY: 'prod-pro-y',
  POLAR_PRODUCT_STUDIO_MONTHLY: 'prod-studio-m',
  // studio yearly intentionally unconfigured
  POLAR_PRODUCT_ARRANGER_MONTHLY: 'prod-arranger-m',
} as NodeJS.ProcessEnv;

describe('polar product mapping', () => {
  it('maps tier + interval to the configured product id', () => {
    expect(productIdFor('pro', 'monthly', env)).toBe('prod-pro-m');
    expect(productIdFor('pro', 'yearly', env)).toBe('prod-pro-y');
    expect(productIdFor('studio', 'monthly', env)).toBe('prod-studio-m');
  });

  it('returns null for unconfigured combinations', () => {
    expect(productIdFor('studio', 'yearly', env)).toBeNull();
    expect(productIdFor('pro', 'monthly', {} as NodeJS.ProcessEnv)).toBeNull();
  });

  it('treats blank env values as unconfigured', () => {
    expect(
      productIdFor('pro', 'monthly', { POLAR_PRODUCT_PRO_MONTHLY: '  ' } as NodeJS.ProcessEnv),
    ).toBeNull();
  });

  it('reverse-maps product ids to tiers and intervals', () => {
    expect(tierForProduct('prod-pro-y', env)).toBe('pro');
    expect(tierForProduct('prod-studio-m', env)).toBe('studio');
    expect(tierForProduct('prod-arranger-m', env)).toBe('arranger');
    expect(tierForProduct('someone-elses-product', env)).toBeNull();
    expect(intervalForProduct('prod-pro-y', env)).toBe('yearly');
    expect(intervalForProduct('prod-studio-m', env)).toBe('monthly');
    expect(intervalForProduct(null, env)).toBeNull();
  });

  it('validates tier ids and intervals', () => {
    expect(isPaidTierId('pro')).toBe(true);
    expect(isPaidTierId('arranger')).toBe(true);
    expect(isPaidTierId('beta')).toBe(false);
    expect(isPaidTierId('free')).toBe(false);
    expect(isBillingInterval('yearly')).toBe(true);
    expect(isBillingInterval('weekly')).toBe(false);
  });
});
