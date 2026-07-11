import { describe, expect, it } from 'vitest';

import {
  isPackId,
  PACK_SECONDS,
  packForProduct,
  productIdForPack,
} from '../../../src/billing/polar/packs';

const env = {
  POLAR_PRODUCT_PACK_SINGLE: 'prod-pack-single',
  POLAR_PRODUCT_PACK_EP: 'prod-pack-ep',
  // album intentionally unconfigured
} as NodeJS.ProcessEnv;

describe('polar pack mapping', () => {
  it('grants whole minutes per pack', () => {
    expect(PACK_SECONDS.single).toBe(15 * 60);
    expect(PACK_SECONDS.ep).toBe(45 * 60);
    expect(PACK_SECONDS.album).toBe(150 * 60);
  });

  it('maps packs to the configured product id', () => {
    expect(productIdForPack('single', env)).toBe('prod-pack-single');
    expect(productIdForPack('ep', env)).toBe('prod-pack-ep');
  });

  it('returns null for unconfigured or blank packs', () => {
    expect(productIdForPack('album', env)).toBeNull();
    expect(
      productIdForPack('single', { POLAR_PRODUCT_PACK_SINGLE: '  ' } as NodeJS.ProcessEnv),
    ).toBeNull();
  });

  it('reverse-maps product ids, ignoring subscription products', () => {
    expect(packForProduct('prod-pack-ep', env)).toBe('ep');
    expect(packForProduct('prod-pro-m', env)).toBeNull();
    expect(packForProduct(null, env)).toBeNull();
    expect(packForProduct(undefined, env)).toBeNull();
  });

  it('validates pack ids', () => {
    expect(isPackId('single')).toBe(true);
    expect(isPackId('album')).toBe(true);
    expect(isPackId('pro')).toBe(false);
  });
});
