"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const polar_products_1 = require("../../src/billing/polar-products");
const env = {
    POLAR_PRODUCT_PRO_MONTHLY: 'prod-pro-m',
    POLAR_PRODUCT_PRO_YEARLY: 'prod-pro-y',
    POLAR_PRODUCT_STUDIO_MONTHLY: 'prod-studio-m',
};
(0, vitest_1.describe)('polar product mapping', () => {
    (0, vitest_1.it)('maps tier + interval to the configured product id', () => {
        (0, vitest_1.expect)((0, polar_products_1.productIdFor)('pro', 'monthly', env)).toBe('prod-pro-m');
        (0, vitest_1.expect)((0, polar_products_1.productIdFor)('pro', 'yearly', env)).toBe('prod-pro-y');
        (0, vitest_1.expect)((0, polar_products_1.productIdFor)('studio', 'monthly', env)).toBe('prod-studio-m');
    });
    (0, vitest_1.it)('returns null for unconfigured combinations', () => {
        (0, vitest_1.expect)((0, polar_products_1.productIdFor)('studio', 'yearly', env)).toBeNull();
        (0, vitest_1.expect)((0, polar_products_1.productIdFor)('pro', 'monthly', {})).toBeNull();
    });
    (0, vitest_1.it)('treats blank env values as unconfigured', () => {
        (0, vitest_1.expect)((0, polar_products_1.productIdFor)('pro', 'monthly', { POLAR_PRODUCT_PRO_MONTHLY: '  ' })).toBeNull();
    });
    (0, vitest_1.it)('reverse-maps product ids to tiers and intervals', () => {
        (0, vitest_1.expect)((0, polar_products_1.tierForProduct)('prod-pro-y', env)).toBe('pro');
        (0, vitest_1.expect)((0, polar_products_1.tierForProduct)('prod-studio-m', env)).toBe('studio');
        (0, vitest_1.expect)((0, polar_products_1.tierForProduct)('someone-elses-product', env)).toBeNull();
        (0, vitest_1.expect)((0, polar_products_1.intervalForProduct)('prod-pro-y', env)).toBe('yearly');
        (0, vitest_1.expect)((0, polar_products_1.intervalForProduct)('prod-studio-m', env)).toBe('monthly');
        (0, vitest_1.expect)((0, polar_products_1.intervalForProduct)(null, env)).toBeNull();
    });
    (0, vitest_1.it)('validates tier ids and intervals', () => {
        (0, vitest_1.expect)((0, polar_products_1.isPaidTierId)('pro')).toBe(true);
        (0, vitest_1.expect)((0, polar_products_1.isPaidTierId)('beta')).toBe(false);
        (0, vitest_1.expect)((0, polar_products_1.isPaidTierId)('free')).toBe(false);
        (0, vitest_1.expect)((0, polar_products_1.isBillingInterval)('yearly')).toBe(true);
        (0, vitest_1.expect)((0, polar_products_1.isBillingInterval)('weekly')).toBe(false);
    });
});
//# sourceMappingURL=polar-products.test.js.map