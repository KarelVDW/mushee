import { describe, expect, it } from 'vitest';

import {
  isEntitledStatus,
  patchFromCustomerState,
  patchFromSubscription,
} from '../../src/billing/subscription-state';

const resolveTier = (productId: string) =>
  ({ 'prod-pro': 'pro', 'prod-studio': 'studio' })[productId] ?? null;

const baseSub = {
  id: 'sub-1',
  productId: 'prod-pro',
  customerId: 'cus-1',
  currentPeriodEnd: new Date('2026-08-01T00:00:00Z'),
  cancelAtPeriodEnd: false,
};

describe('subscription lifecycle → row patch', () => {
  it('grants the tier for active/trialing/past_due', () => {
    for (const status of ['active', 'trialing', 'past_due']) {
      expect(isEntitledStatus(status)).toBe(true);
      const patch = patchFromSubscription({ ...baseSub, status }, resolveTier);
      expect(patch).toMatchObject({
        tierId: 'pro',
        polarSubscriptionId: 'sub-1',
        polarProductId: 'prod-pro',
        polarCustomerId: 'cus-1',
        status,
      });
    }
  });

  it('keeps a scheduled cancellation on the paid tier until period end', () => {
    const patch = patchFromSubscription(
      { ...baseSub, status: 'active', cancelAtPeriodEnd: true },
      resolveTier,
    );
    expect(patch?.tierId).toBe('pro');
    expect(patch?.cancelAtPeriodEnd).toBe(true);
  });

  it('drops to free when the subscription is revoked/ended', () => {
    for (const status of ['canceled', 'unpaid', 'incomplete_expired']) {
      const patch = patchFromSubscription({ ...baseSub, status }, resolveTier);
      expect(patch).toMatchObject({
        tierId: 'free',
        polarSubscriptionId: null,
        polarProductId: null,
        currentPeriodEnd: null,
        cancelAtPeriodEnd: false,
      });
    }
  });

  it('ignores products that are not ours', () => {
    expect(
      patchFromSubscription({ ...baseSub, productId: 'foreign', status: 'active' }, resolveTier),
    ).toBeNull();
  });
});

describe('customer.state_changed reconciliation', () => {
  it('adopts the first entitled subscription in the snapshot', () => {
    const patch = patchFromCustomerState(
      {
        id: 'cus-1',
        activeSubscriptions: [
          { id: 'sub-x', status: 'active', productId: 'foreign' },
          { id: 'sub-2', status: 'active', productId: 'prod-studio' },
        ],
      },
      resolveTier,
      'free',
    );
    expect(patch).toMatchObject({ tierId: 'studio', polarSubscriptionId: 'sub-2' });
  });

  it('downgrades a paid tier when no active subscription remains', () => {
    const patch = patchFromCustomerState(
      { id: 'cus-1', activeSubscriptions: [] },
      resolveTier,
      'pro',
    );
    expect(patch).toMatchObject({ tierId: 'free', polarSubscriptionId: null });
  });

  it('never touches beta or free users without subscriptions', () => {
    expect(patchFromCustomerState({ id: 'cus-1', activeSubscriptions: [] }, resolveTier, 'beta')).toBeNull();
    expect(patchFromCustomerState({ id: 'cus-1', activeSubscriptions: [] }, resolveTier, 'free')).toBeNull();
    expect(
      patchFromCustomerState({ id: 'cus-1', activeSubscriptions: [] }, resolveTier, undefined),
    ).toBeNull();
  });
});
