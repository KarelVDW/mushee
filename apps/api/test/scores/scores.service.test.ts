import 'reflect-metadata';

import { ForbiddenException } from '@nestjs/common';
import type { Repository } from 'typeorm';
import { describe, expect, it, vi } from 'vitest';

import type { CacheService } from '../../src/cache/cache.service';
import type { CreateScoreDto } from '../../src/scores/dto/create-score.dto';
import type { Score } from '../../src/scores/entities/score.entity';
import { ScoresService } from '../../src/scores/scores.service';
import type { StorageService } from '../../src/storage/storage.service';
import type { SubscriptionTier } from '../../src/subscriptions/entities/subscription-tier.entity';
import type { SubscriptionsService } from '../../src/subscriptions/subscriptions.service';

// TypeORM entity decorators need emitDecoratorMetadata, which vitest's
// esbuild transform doesn't emit — mock the entity module and the injected
// services' modules at the seam (same pattern as the billing/recording tests).
vi.mock('../../src/scores/entities/score.entity', () => ({
  Score: class Score {},
}));
vi.mock('../../src/cache/cache.service', () => ({
  CacheService: class CacheService {},
}));
vi.mock('../../src/storage/storage.service', () => ({
  StorageService: class StorageService {},
}));

function tier(maxScores: number | null): SubscriptionTier {
  return {
    id: 'free',
    name: 'Sketch',
    dailyRecordingCredits: 180,
    maxScores,
    sortOrder: 0,
    sellable: true,
  } as SubscriptionTier;
}

function makeService(t: SubscriptionTier, existingScores: number) {
  const scoreRepo = {
    create: vi.fn((data: Partial<Score>) => data as Score),
    save: vi.fn((score: Score) => Promise.resolve({ ...score, id: 's1' })),
    countBy: vi.fn(() => Promise.resolve(existingScores)),
  };
  const cache = { upsert: vi.fn(() => Promise.resolve()) };
  const subscriptions = { tierFor: vi.fn(() => Promise.resolve(t)) };

  const service = new ScoresService(
    scoreRepo as unknown as Repository<Score>,
    cache as unknown as CacheService,
    {} as StorageService,
    subscriptions as unknown as SubscriptionsService,
  );
  return { service, scoreRepo, cache };
}

const DTO = { title: 'Étude', score: {} } as unknown as CreateScoreDto;

describe('create', () => {
  it('creates and caches a score below the cap', async () => {
    const { service, scoreRepo, cache } = makeService(tier(5), 4);
    const saved = await service.create('u1', DTO);
    expect(saved.id).toBe('s1');
    expect(scoreRepo.save).toHaveBeenCalled();
    expect(cache.upsert).toHaveBeenCalledWith('s1', {});
  });

  it('refuses the create once the cap is reached', async () => {
    const { service, scoreRepo } = makeService(tier(5), 5);
    const attempt = service.create('u1', DTO);
    await expect(attempt).rejects.toBeInstanceOf(ForbiddenException);
    await expect(attempt).rejects.toMatchObject({
      response: { code: 'score-limit' },
    });
    expect(scoreRepo.save).not.toHaveBeenCalled();
  });

  it('names the plan and its cap in the refusal', async () => {
    const { service } = makeService(tier(5), 9);
    await expect(service.create('u1', DTO)).rejects.toMatchObject({
      response: {
        message: 'Your Sketch plan holds up to 5 scores. Upgrade to add more.',
      },
    });
  });

  it('never counts or refuses on uncapped tiers', async () => {
    const { service, scoreRepo } = makeService(tier(null), 9999);
    const saved = await service.create('u1', DTO);
    expect(saved.id).toBe('s1');
    expect(scoreRepo.countBy).not.toHaveBeenCalled();
  });
});
