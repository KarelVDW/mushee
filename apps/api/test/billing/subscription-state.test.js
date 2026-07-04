"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const subscription_state_1 = require("../../src/billing/subscription-state");
const resolveTier = (productId) => ({ 'prod-pro': 'pro', 'prod-studio': 'studio' })[productId] ?? null;
const baseSub = {
    id: 'sub-1',
    productId: 'prod-pro',
    customerId: 'cus-1',
    currentPeriodEnd: new Date('2026-08-01T00:00:00Z'),
    cancelAtPeriodEnd: false,
};
(0, vitest_1.describe)('subscription lifecycle → row patch', () => {
    (0, vitest_1.it)('grants the tier for active/trialing/past_due', () => {
        for (const status of ['active', 'trialing', 'past_due']) {
            (0, vitest_1.expect)((0, subscription_state_1.isEntitledStatus)(status)).toBe(true);
            const patch = (0, subscription_state_1.patchFromSubscription)({ ...baseSub, status }, resolveTier);
            (0, vitest_1.expect)(patch).toMatchObject({
                tierId: 'pro',
                polarSubscriptionId: 'sub-1',
                polarProductId: 'prod-pro',
                polarCustomerId: 'cus-1',
                status,
            });
        }
    });
    (0, vitest_1.it)('keeps a scheduled cancellation on the paid tier until period end', () => {
        const patch = (0, subscription_state_1.patchFromSubscription)({ ...baseSub, status: 'active', cancelAtPeriodEnd: true }, resolveTier);
        (0, vitest_1.expect)(patch?.tierId).toBe('pro');
        (0, vitest_1.expect)(patch?.cancelAtPeriodEnd).toBe(true);
    });
    (0, vitest_1.it)('drops to free when the subscription is revoked/ended', () => {
        for (const status of ['canceled', 'unpaid', 'incomplete_expired']) {
            const patch = (0, subscription_state_1.patchFromSubscription)({ ...baseSub, status }, resolveTier);
            (0, vitest_1.expect)(patch).toMatchObject({
                tierId: 'free',
                polarSubscriptionId: null,
                polarProductId: null,
                currentPeriodEnd: null,
                cancelAtPeriodEnd: false,
            });
        }
    });
    (0, vitest_1.it)('ignores products that are not ours', () => {
        (0, vitest_1.expect)((0, subscription_state_1.patchFromSubscription)({ ...baseSub, productId: 'foreign', status: 'active' }, resolveTier)).toBeNull();
    });
});
(0, vitest_1.describe)('customer.state_changed reconciliation', () => {
    (0, vitest_1.it)('adopts the first entitled subscription in the snapshot', () => {
        const patch = (0, subscription_state_1.patchFromCustomerState)({
            id: 'cus-1',
            activeSubscriptions: [
                { id: 'sub-x', status: 'active', productId: 'foreign' },
                { id: 'sub-2', status: 'active', productId: 'prod-studio' },
            ],
        }, resolveTier, 'free');
        (0, vitest_1.expect)(patch).toMatchObject({ tierId: 'studio', polarSubscriptionId: 'sub-2' });
    });
    (0, vitest_1.it)('downgrades a paid tier when no active subscription remains', () => {
        const patch = (0, subscription_state_1.patchFromCustomerState)({ id: 'cus-1', activeSubscriptions: [] }, resolveTier, 'pro');
        (0, vitest_1.expect)(patch).toMatchObject({ tierId: 'free', polarSubscriptionId: null });
    });
    (0, vitest_1.it)('never touches beta or free users without subscriptions', () => {
        (0, vitest_1.expect)((0, subscription_state_1.patchFromCustomerState)({ id: 'cus-1', activeSubscriptions: [] }, resolveTier, 'beta')).toBeNull();
        (0, vitest_1.expect)((0, subscription_state_1.patchFromCustomerState)({ id: 'cus-1', activeSubscriptions: [] }, resolveTier, 'free')).toBeNull();
        (0, vitest_1.expect)((0, subscription_state_1.patchFromCustomerState)({ id: 'cus-1', activeSubscriptions: [] }, resolveTier, undefined)).toBeNull();
    });
});
//# sourceMappingURL=subscription-state.test.js.map