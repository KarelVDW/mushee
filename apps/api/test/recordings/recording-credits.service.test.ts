import 'reflect-metadata';

import type { Repository } from 'typeorm';
import { describe, expect, it, vi } from 'vitest';

import type { CreditBalance } from '../../src/recordings/entities/credit-balance.entity';
import type { RecordingUsage } from '../../src/recordings/entities/recording-usage.entity';
import { RecordingCreditsService } from '../../src/recordings/recording-credits.service';
import type { SubscriptionTier } from '../../src/subscriptions/entities/subscription-tier.entity';
import type { SubscriptionsService } from '../../src/subscriptions/subscriptions.service';

// TypeORM entity decorators need emitDecoratorMetadata, which vitest's
// esbuild transform doesn't emit — mock the entity modules (same pattern as
// the billing service tests).
vi.mock('../../src/recordings/entities/recording-usage.entity', () => ({
  RecordingUsage: class RecordingUsage {},
}));
vi.mock('../../src/recordings/entities/credit-balance.entity', () => ({
  CreditBalance: class CreditBalance {},
}));

function tier(dailyRecordingCredits: number | null): SubscriptionTier {
  return { id: 't', name: 'T', dailyRecordingCredits, sortOrder: 0, sellable: true } as SubscriptionTier;
}

/**
 * Hand-rolled fakes with real arithmetic: the usage upsert accumulates per
 * (user, day) and the pack drawdown clamps at zero, mirroring the SQL the
 * service runs, so the overflow logic is exercised against real state.
 */
function makeService(t: SubscriptionTier, packSeconds = 0) {
  const state = { used: 0, pack: packSeconds };

  const usageRepo = {
    query: vi.fn((_sql: string, params: unknown[]) => {
      state.used += params[2] as number;
      return Promise.resolve([{ creditsUsed: state.used }]);
    }),
    findOneBy: vi.fn(() =>
      Promise.resolve(state.used > 0 ? { creditsUsed: state.used } : null),
    ),
    delete: vi.fn(() => Promise.resolve({})),
  };
  const balanceRepo = {
    query: vi.fn((sql: string, params: unknown[]) => {
      if (sql.includes('INSERT')) {
        state.pack += params[1] as number;
        return Promise.resolve([]);
      }
      state.pack = Math.max(0, state.pack - (params[1] as number));
      return Promise.resolve([{ seconds: state.pack }]);
    }),
    findOneBy: vi.fn(() => Promise.resolve({ seconds: state.pack })),
    delete: vi.fn(() => Promise.resolve({})),
  };
  const subscriptions = { tierFor: vi.fn(() => Promise.resolve(t)) };

  const service = new RecordingCreditsService(
    usageRepo as unknown as Repository<RecordingUsage>,
    balanceRepo as unknown as Repository<CreditBalance>,
    subscriptions as unknown as SubscriptionsService,
  );
  return { service, state, usageRepo, balanceRepo };
}

describe('balance', () => {
  it('reports the daily budget and the pack balance side by side', async () => {
    const { service } = makeService(tier(600), 900);
    const balance = await service.balance('u1');
    expect(balance).toMatchObject({
      used: 0,
      remaining: 600,
      packSeconds: 900,
      exhausted: false,
    });
  });

  it('is not exhausted on an empty daily budget while pack seconds remain', async () => {
    const { service, state } = makeService(tier(600), 60);
    state.used = 600;
    const balance = await service.balance('u1');
    expect(balance).toMatchObject({ remaining: 0, packSeconds: 60, exhausted: false });
  });

  it('is exhausted only when both pools are empty', async () => {
    const { service, state } = makeService(tier(600), 0);
    state.used = 600;
    const balance = await service.balance('u1');
    expect(balance).toMatchObject({ remaining: 0, packSeconds: 0, exhausted: true });
  });
});

describe('spend', () => {
  it('bills the daily budget without ever touching packs below the limit', async () => {
    const { service, balanceRepo } = makeService(tier(600), 900);
    const balance = await service.spend('u1', 10);
    expect(balance).toMatchObject({ used: 10, remaining: 590, exhausted: false });
    expect(balanceRepo.query).not.toHaveBeenCalled();
    expect(balanceRepo.findOneBy).not.toHaveBeenCalled();
  });

  it('draws only the overflow slice from packs on the boundary-crossing tick', async () => {
    const { service, state } = makeService(tier(600), 900);
    state.used = 598;
    // 5 seconds: 2 still covered by the daily budget, 3 spill into the pack.
    const balance = await service.spend('u1', 5);
    expect(state.pack).toBe(897);
    expect(balance).toMatchObject({ used: 603, remaining: 0, packSeconds: 897, exhausted: false });
  });

  it('draws whole ticks from packs once the daily budget is spent', async () => {
    const { service, state } = makeService(tier(600), 10);
    state.used = 600;
    const balance = await service.spend('u1', 1);
    expect(state.pack).toBe(9);
    expect(balance.exhausted).toBe(false);
  });

  it('exhausts when the last pack second is drawn', async () => {
    const { service, state } = makeService(tier(600), 1);
    state.used = 600;
    const balance = await service.spend('u1', 1);
    expect(state.pack).toBe(0);
    expect(balance).toMatchObject({ packSeconds: 0, exhausted: true });
  });

  it('reads (without drawing) when a tick lands exactly on the limit', async () => {
    const { service, state, balanceRepo } = makeService(tier(600), 42);
    state.used = 599;
    const balance = await service.spend('u1', 1);
    expect(balanceRepo.query).toHaveBeenCalledTimes(0);
    expect(balanceRepo.findOneBy).toHaveBeenCalledTimes(1);
    expect(balance).toMatchObject({ remaining: 0, packSeconds: 42, exhausted: false });
  });

  it('never exhausts and never touches packs on unlimited tiers', async () => {
    const { service, state, balanceRepo } = makeService(tier(null), 60);
    state.used = 99999;
    const balance = await service.spend('u1', 10);
    expect(balance).toMatchObject({ remaining: null, exhausted: false });
    expect(balanceRepo.query).not.toHaveBeenCalled();
    expect(state.pack).toBe(60);
  });
});

describe('pack grants and revocations', () => {
  it('accumulates granted seconds', async () => {
    const { service, state } = makeService(tier(600), 0);
    await service.grantPackSeconds('u1', 900);
    await service.grantPackSeconds('u1', 2700);
    expect(state.pack).toBe(3600);
  });

  it('clamps revocations at zero', async () => {
    const { service, state } = makeService(tier(600), 300);
    await service.revokePackSeconds('u1', 900);
    expect(state.pack).toBe(0);
  });
});

describe('deleteAllForUser', () => {
  it('removes usage rows and the pack balance', async () => {
    const { service, usageRepo, balanceRepo } = makeService(tier(600));
    await service.deleteAllForUser('u1');
    expect(usageRepo.delete).toHaveBeenCalledWith({ userId: 'u1' });
    expect(balanceRepo.delete).toHaveBeenCalledWith({ userId: 'u1' });
  });
});
