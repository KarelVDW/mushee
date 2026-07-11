import 'reflect-metadata';

import {
  BadRequestException,
  ForbiddenException,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { Polar } from '@polar-sh/sdk';
import type { EntityManager, Repository } from 'typeorm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { BillingService } from '../../src/billing/billing.service';
import type { ProcessedWebhookEvent } from '../../src/billing/entities/processed-webhook-event.entity';
import { isBillingConfigured, polarClient } from '../../src/billing/polar/client';
import {
  validateEvent,
  WebhookVerificationError,
} from '../../src/billing/polar/webhook-verify';
import type { RecordingCreditsService } from '../../src/recordings/recording-credits.service';
import type { SubscriptionsService } from '../../src/subscriptions/subscriptions.service';

// The Polar SDK client and the webhook signature shim are third-party code;
// the entity's TypeORM decorators need emitDecoratorMetadata, which vitest's
// esbuild transform doesn't emit — mock all three at the module seam.
vi.mock('../../src/billing/polar/client', () => ({
  polarClient: vi.fn(),
  isBillingConfigured: vi.fn(),
}));
vi.mock('../../src/billing/polar/webhook-verify', () => {
  class WebhookVerificationError extends Error {}
  return { validateEvent: vi.fn(), WebhookVerificationError };
});
vi.mock('../../src/billing/entities/processed-webhook-event.entity', () => ({
  ProcessedWebhookEvent: class ProcessedWebhookEvent {},
}));

Logger.overrideLogger(false);

const PRO_MONTHLY = 'prod-pro-m';
const PRO_YEARLY = 'prod-pro-y';
const PACK_SINGLE = 'prod-pack-single';
const USER = { id: 'user-1', email: 'user@example.com' };
const WEBHOOK_HEADERS = { 'webhook-id': 'wh-1' };

function fakePolar() {
  return {
    checkouts: {
      create: vi.fn(() => Promise.resolve({ url: 'https://polar.sh/checkout/1' })),
    },
    customerSessions: {
      create: vi.fn(() => Promise.resolve({ customerPortalUrl: 'https://polar.sh/portal/1' })),
    },
    subscriptions: { update: vi.fn(() => Promise.resolve({})) },
    customers: { deleteExternal: vi.fn(() => Promise.resolve({})) },
  };
}

function configurePolar(polar: ReturnType<typeof fakePolar> | null) {
  vi.mocked(polarClient).mockReturnValue(polar as unknown as Polar | null);
  vi.mocked(isBillingConfigured).mockReturnValue(polar !== null);
}

/** BillingService with hand-rolled fakes for its three injected dependencies. */
function makeService(
  opts: {
    row?: Record<string, unknown> | null;
    duplicateDelivery?: boolean;
  } = {},
) {
  const tiers: Record<string, unknown> = {
    pro: { id: 'pro', name: 'Pro', dailyRecordingCredits: 3600 },
    free: { id: 'free', name: 'Free', dailyRecordingCredits: 300 },
  };
  const subscriptions = {
    findForUser: vi.fn(() => Promise.resolve(opts.row ?? null)),
    tierById: vi.fn((id?: string | null) => Promise.resolve(tiers[id ?? 'free'] ?? tiers.free)),
    upsert: vi.fn(() => Promise.resolve({})),
  };
  const credits = {
    balance: vi.fn(() => Promise.resolve({ used: 60, remaining: 3540, packSeconds: 120 })),
    grantPackSeconds: vi.fn(() => Promise.resolve()),
    revokePackSeconds: vi.fn(() => Promise.resolve()),
  };
  // Minimal EntityManager: the dedupe insert query builder + a transaction
  // that simply runs the callback against itself.
  const insertResult = {
    identifiers: opts.duplicateDelivery ? [] : [{ id: 'wh-1' }],
  };
  const qb = {
    insert: () => qb,
    into: () => qb,
    values: () => qb,
    orIgnore: () => qb,
    execute: vi.fn(() => Promise.resolve(insertResult)),
  };
  const manager = {
    createQueryBuilder: () => qb,
    transaction: async (cb: (em: EntityManager) => Promise<void>) =>
      cb(manager as unknown as EntityManager),
  };
  const service = new BillingService(
    { manager } as unknown as Repository<ProcessedWebhookEvent>,
    subscriptions as unknown as SubscriptionsService,
    credits as unknown as RecordingCreditsService,
  );
  return { service, subscriptions, credits };
}

const ENV_KEYS = [
  'BETA_MODE',
  'POLAR_WEBHOOK_SECRET',
  'WEB_APP_URL',
  'CORS_ORIGIN',
  'POLAR_PRODUCT_PRO_MONTHLY',
  'POLAR_PRODUCT_PRO_YEARLY',
  'POLAR_PRODUCT_STUDIO_MONTHLY',
  'POLAR_PRODUCT_STUDIO_YEARLY',
  'POLAR_PRODUCT_ARRANGER_MONTHLY',
  'POLAR_PRODUCT_ARRANGER_YEARLY',
  'POLAR_PRODUCT_PACK_SINGLE',
  'POLAR_PRODUCT_PACK_EP',
  'POLAR_PRODUCT_PACK_ALBUM',
];
const savedEnv: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const key of ENV_KEYS) {
    savedEnv[key] = process.env[key];
    delete process.env[key];
  }
  process.env.POLAR_PRODUCT_PRO_MONTHLY = PRO_MONTHLY;
  process.env.POLAR_PRODUCT_PRO_YEARLY = PRO_YEARLY;
  process.env.POLAR_PRODUCT_PACK_SINGLE = PACK_SINGLE;
  process.env.POLAR_WEBHOOK_SECRET = 'whsec_test';
  vi.mocked(validateEvent).mockReset();
  configurePolar(null);
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
});

describe('getState', () => {
  it('assembles tier, subscription state and credits for a paid user', async () => {
    configurePolar(fakePolar());
    const { service } = makeService({
      row: {
        tierId: 'pro',
        status: 'active',
        polarProductId: PRO_MONTHLY,
        currentPeriodEnd: new Date('2026-08-01T00:00:00Z'),
        cancelAtPeriodEnd: true,
      },
    });
    expect(await service.getState(USER.id)).toEqual({
      tierId: 'pro',
      tierName: 'Pro',
      status: 'active',
      interval: 'monthly',
      currentPeriodEnd: '2026-08-01T00:00:00.000Z',
      cancelAtPeriodEnd: true,
      billingConfigured: true,
      betaMode: false,
      credits: { limitSeconds: 3600, usedSeconds: 60, remainingSeconds: 3540, packSeconds: 120 },
    });
  });

  it('falls back to the free tier with null billing fields when there is no row', async () => {
    process.env.BETA_MODE = 'true';
    const { service } = makeService({ row: null });
    expect(await service.getState(USER.id)).toMatchObject({
      tierId: 'free',
      status: null,
      interval: null,
      currentPeriodEnd: null,
      cancelAtPeriodEnd: false,
      billingConfigured: false,
      betaMode: true,
      credits: { limitSeconds: 300 },
    });
  });
});

describe('createCheckout', () => {
  it('is forbidden in beta mode', async () => {
    process.env.BETA_MODE = 'true';
    const { service } = makeService();
    await expect(service.createCheckout(USER, 'pro', 'monthly')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('answers 503 when Polar is not configured', async () => {
    const { service } = makeService();
    await expect(service.createCheckout(USER, 'pro', 'monthly')).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });

  it('rejects tier/interval combinations without a configured product', async () => {
    configurePolar(fakePolar());
    const { service } = makeService();
    await expect(service.createCheckout(USER, 'studio', 'yearly')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('creates a Polar checkout keyed to the user, forwarding the client IP for currency geolocation', async () => {
    process.env.WEB_APP_URL = 'https://app.example.com/';
    const polar = fakePolar();
    configurePolar(polar);
    const { service } = makeService();
    await expect(
      service.createCheckout(USER, 'pro', 'monthly', '203.0.113.7'),
    ).resolves.toEqual({
      url: 'https://polar.sh/checkout/1',
    });
    expect(polar.checkouts.create).toHaveBeenCalledWith({
      products: [PRO_MONTHLY],
      externalCustomerId: USER.id,
      customerEmail: USER.email,
      customerIpAddress: '203.0.113.7',
      successUrl: 'https://app.example.com/settings?checkout=success',
      metadata: { userId: USER.id },
    });
  });
});

describe('createPackCheckout', () => {
  it('is forbidden in beta mode', async () => {
    process.env.BETA_MODE = 'true';
    const { service } = makeService();
    await expect(service.createPackCheckout(USER, 'single')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('answers 503 when Polar is not configured', async () => {
    const { service } = makeService();
    await expect(service.createPackCheckout(USER, 'single')).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });

  it('rejects packs without a configured product', async () => {
    configurePolar(fakePolar());
    const { service } = makeService();
    await expect(service.createPackCheckout(USER, 'album')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('creates a one-time checkout keyed to the user and pack, forwarding the client IP', async () => {
    process.env.WEB_APP_URL = 'https://app.example.com/';
    const polar = fakePolar();
    configurePolar(polar);
    const { service } = makeService();
    await expect(
      service.createPackCheckout(USER, 'single', '203.0.113.7'),
    ).resolves.toEqual({
      url: 'https://polar.sh/checkout/1',
    });
    expect(polar.checkouts.create).toHaveBeenCalledWith({
      products: [PACK_SINGLE],
      externalCustomerId: USER.id,
      customerEmail: USER.email,
      customerIpAddress: '203.0.113.7',
      successUrl: 'https://app.example.com/settings?pack=success',
      metadata: { userId: USER.id, packId: 'single' },
    });
  });
});

describe('changePlan', () => {
  it('requires an active subscription', async () => {
    configurePolar(fakePolar());
    const { service } = makeService({ row: null });
    await expect(service.changePlan(USER.id, 'pro', 'yearly')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('rejects a switch to an unconfigured product', async () => {
    configurePolar(fakePolar());
    const { service } = makeService({ row: { polarSubscriptionId: 'sub-1' } });
    await expect(service.changePlan(USER.id, 'studio', 'monthly')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('updates the Polar subscription and mirrors the new product locally', async () => {
    const polar = fakePolar();
    configurePolar(polar);
    const { service, subscriptions } = makeService({
      row: { tierId: 'pro', polarSubscriptionId: 'sub-1', polarProductId: PRO_MONTHLY },
    });
    const state = await service.changePlan(USER.id, 'pro', 'yearly');
    expect(polar.subscriptions.update).toHaveBeenCalledWith({
      id: 'sub-1',
      subscriptionUpdate: { productId: PRO_YEARLY },
    });
    expect(subscriptions.upsert).toHaveBeenCalledWith(USER.id, {
      tierId: 'pro',
      polarProductId: PRO_YEARLY,
    });
    expect(state.tierId).toBe('pro');
  });
});

describe('cancelAtPeriodEnd / resumeSubscription', () => {
  it('requires an active subscription', async () => {
    configurePolar(fakePolar());
    const { service } = makeService({ row: {} });
    await expect(service.cancelAtPeriodEnd(USER.id)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(service.resumeSubscription(USER.id)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('schedules and undoes cancellation via Polar, mirroring immediately', async () => {
    const polar = fakePolar();
    configurePolar(polar);
    const { service, subscriptions } = makeService({
      row: { tierId: 'pro', polarSubscriptionId: 'sub-1' },
    });

    await service.cancelAtPeriodEnd(USER.id);
    expect(polar.subscriptions.update).toHaveBeenLastCalledWith({
      id: 'sub-1',
      subscriptionUpdate: { cancelAtPeriodEnd: true },
    });
    expect(subscriptions.upsert).toHaveBeenLastCalledWith(USER.id, {
      cancelAtPeriodEnd: true,
    });

    await service.resumeSubscription(USER.id);
    expect(polar.subscriptions.update).toHaveBeenLastCalledWith({
      id: 'sub-1',
      subscriptionUpdate: { cancelAtPeriodEnd: false },
    });
    expect(subscriptions.upsert).toHaveBeenLastCalledWith(USER.id, {
      cancelAtPeriodEnd: false,
    });
  });
});

describe('handleWebhook', () => {
  const rawBody = Buffer.from('{}');

  function subscriptionEvent(data: Record<string, unknown>) {
    vi.mocked(validateEvent).mockReturnValue({
      type: 'subscription.active',
      data: {
        id: 'sub-1',
        status: 'active',
        productId: PRO_MONTHLY,
        customer: { externalId: USER.id },
        modifiedAt: new Date('2026-07-08T12:00:00Z'),
        ...data,
      },
    });
  }

  it('throws WebhookVerificationError when no secret is configured', async () => {
    delete process.env.POLAR_WEBHOOK_SECRET;
    const { service } = makeService();
    await expect(service.handleWebhook(rawBody, WEBHOOK_HEADERS)).rejects.toBeInstanceOf(
      WebhookVerificationError,
    );
    expect(validateEvent).not.toHaveBeenCalled();
  });

  it('propagates signature failures from validateEvent', async () => {
    vi.mocked(validateEvent).mockImplementation(() => {
      throw new WebhookVerificationError('bad signature');
    });
    const { service } = makeService();
    await expect(service.handleWebhook(rawBody, WEBHOOK_HEADERS)).rejects.toBeInstanceOf(
      WebhookVerificationError,
    );
  });

  it('returns false for a duplicate delivery id without applying anything', async () => {
    subscriptionEvent({});
    const { service, subscriptions } = makeService({ duplicateDelivery: true });
    await expect(service.handleWebhook(rawBody, WEBHOOK_HEADERS)).resolves.toBe(false);
    expect(subscriptions.upsert).not.toHaveBeenCalled();
  });

  it('verifies with the configured secret and upserts the subscription patch', async () => {
    subscriptionEvent({});
    const { service, subscriptions } = makeService();
    await expect(service.handleWebhook(rawBody, WEBHOOK_HEADERS)).resolves.toBe(true);
    expect(validateEvent).toHaveBeenCalledWith(rawBody, WEBHOOK_HEADERS, 'whsec_test');
    expect(subscriptions.upsert).toHaveBeenCalledWith(
      USER.id,
      expect.objectContaining({
        tierId: 'pro',
        polarSubscriptionId: 'sub-1',
        polarProductId: PRO_MONTHLY,
        status: 'active',
      }),
      expect.anything(),
    );
  });

  it('acknowledges but ignores events without an external customer id', async () => {
    subscriptionEvent({ customer: {}, metadata: {} });
    const { service, subscriptions } = makeService();
    await expect(service.handleWebhook(rawBody, WEBHOOK_HEADERS)).resolves.toBe(true);
    expect(subscriptions.upsert).not.toHaveBeenCalled();
  });

  it('acknowledges but ignores products that are not mapped to a tier', async () => {
    subscriptionEvent({ productId: 'someone-elses-product' });
    const { service, subscriptions } = makeService();
    await expect(service.handleWebhook(rawBody, WEBHOOK_HEADERS)).resolves.toBe(true);
    expect(subscriptions.upsert).not.toHaveBeenCalled();
  });

  it('drops out-of-order events older than the last applied one', async () => {
    subscriptionEvent({ modifiedAt: new Date('2026-07-01T00:00:00Z') });
    const { service, subscriptions } = makeService({
      row: { tierId: 'free', lastPolarEventAt: new Date('2026-07-05T00:00:00Z') },
    });
    await expect(service.handleWebhook(rawBody, WEBHOOK_HEADERS)).resolves.toBe(true);
    expect(subscriptions.upsert).not.toHaveBeenCalled();
  });

  it('reconciles customer.state_changed snapshots', async () => {
    vi.mocked(validateEvent).mockReturnValue({
      type: 'customer.state_changed',
      data: {
        id: 'cus-1',
        externalId: USER.id,
        activeSubscriptions: [
          { id: 'sub-2', status: 'active', productId: PRO_MONTHLY },
        ],
      },
    });
    const { service, subscriptions } = makeService();
    await expect(service.handleWebhook(rawBody, WEBHOOK_HEADERS)).resolves.toBe(true);
    expect(subscriptions.upsert).toHaveBeenCalledWith(
      USER.id,
      expect.objectContaining({
        tierId: 'pro',
        polarSubscriptionId: 'sub-2',
        polarCustomerId: 'cus-1',
      }),
      expect.anything(),
    );
  });

  it('acknowledges unrelated event types without mirroring anything', async () => {
    vi.mocked(validateEvent).mockReturnValue({ type: 'benefit.created', data: {} });
    const { service, subscriptions } = makeService();
    await expect(service.handleWebhook(rawBody, WEBHOOK_HEADERS)).resolves.toBe(true);
    expect(subscriptions.upsert).not.toHaveBeenCalled();
  });

  it('grants pack seconds on order.paid for a pack product', async () => {
    vi.mocked(validateEvent).mockReturnValue({
      type: 'order.paid',
      data: { productId: PACK_SINGLE, customer: { externalId: USER.id } },
    });
    const { service, credits } = makeService();
    await expect(service.handleWebhook(rawBody, WEBHOOK_HEADERS)).resolves.toBe(true);
    expect(credits.grantPackSeconds).toHaveBeenCalledWith(
      USER.id,
      15 * 60,
      expect.anything(),
    );
  });

  it('falls back to checkout metadata when the order has no external customer id', async () => {
    vi.mocked(validateEvent).mockReturnValue({
      type: 'order.paid',
      data: { productId: PACK_SINGLE, customer: {}, metadata: { userId: USER.id } },
    });
    const { service, credits } = makeService();
    await expect(service.handleWebhook(rawBody, WEBHOOK_HEADERS)).resolves.toBe(true);
    expect(credits.grantPackSeconds).toHaveBeenCalledWith(
      USER.id,
      15 * 60,
      expect.anything(),
    );
  });

  it('ignores order.paid for subscription invoices (non-pack products)', async () => {
    vi.mocked(validateEvent).mockReturnValue({
      type: 'order.paid',
      data: { productId: PRO_MONTHLY, customer: { externalId: USER.id } },
    });
    const { service, credits } = makeService();
    await expect(service.handleWebhook(rawBody, WEBHOOK_HEADERS)).resolves.toBe(true);
    expect(credits.grantPackSeconds).not.toHaveBeenCalled();
  });

  it('ignores order.created even for pack products (only order.paid grants)', async () => {
    vi.mocked(validateEvent).mockReturnValue({
      type: 'order.created',
      data: { productId: PACK_SINGLE, customer: { externalId: USER.id } },
    });
    const { service, credits } = makeService();
    await expect(service.handleWebhook(rawBody, WEBHOOK_HEADERS)).resolves.toBe(true);
    expect(credits.grantPackSeconds).not.toHaveBeenCalled();
  });

  it('acknowledges but ignores a pack order without any user id', async () => {
    vi.mocked(validateEvent).mockReturnValue({
      type: 'order.paid',
      data: { productId: PACK_SINGLE, customer: {}, metadata: {} },
    });
    const { service, credits } = makeService();
    await expect(service.handleWebhook(rawBody, WEBHOOK_HEADERS)).resolves.toBe(true);
    expect(credits.grantPackSeconds).not.toHaveBeenCalled();
  });

  it('revokes pack seconds on order.refunded, but only for pack products', async () => {
    vi.mocked(validateEvent).mockReturnValue({
      type: 'order.refunded',
      data: { productId: PACK_SINGLE, customer: { externalId: USER.id } },
    });
    const { service, credits } = makeService();
    await expect(service.handleWebhook(rawBody, WEBHOOK_HEADERS)).resolves.toBe(true);
    expect(credits.revokePackSeconds).toHaveBeenCalledWith(
      USER.id,
      15 * 60,
      expect.anything(),
    );

    vi.mocked(validateEvent).mockReturnValue({
      type: 'order.refunded',
      data: { productId: PRO_MONTHLY, customer: { externalId: USER.id } },
    });
    const second = makeService();
    await expect(second.service.handleWebhook(rawBody, WEBHOOK_HEADERS)).resolves.toBe(true);
    expect(second.credits.revokePackSeconds).not.toHaveBeenCalled();
  });
});

describe('deletePolarCustomer', () => {
  it('is a no-op when Polar is not configured', async () => {
    const { service } = makeService();
    await expect(service.deletePolarCustomer(USER.id)).resolves.toBeUndefined();
  });

  it('deletes the customer by external id', async () => {
    const polar = fakePolar();
    configurePolar(polar);
    const { service } = makeService();
    await service.deletePolarCustomer(USER.id);
    expect(polar.customers.deleteExternal).toHaveBeenCalledWith({
      externalId: USER.id,
    });
  });

  it('swallows a 404 (customer never checked out)', async () => {
    const polar = fakePolar();
    polar.customers.deleteExternal.mockRejectedValue(
      Object.assign(new Error('not found'), { statusCode: 404 }),
    );
    configurePolar(polar);
    const { service } = makeService();
    await expect(service.deletePolarCustomer(USER.id)).resolves.toBeUndefined();
  });

  it('rethrows other Polar errors so the purge cron retries', async () => {
    const polar = fakePolar();
    polar.customers.deleteExternal.mockRejectedValue(
      Object.assign(new Error('rate limited'), { status: 429 }),
    );
    configurePolar(polar);
    const { service } = makeService();
    await expect(service.deletePolarCustomer(USER.id)).rejects.toThrow('rate limited');
  });
});
