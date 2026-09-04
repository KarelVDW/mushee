import 'reflect-metadata';

import { ForbiddenException, NotFoundException } from '@nestjs/common';
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

const SOURCE = {
  id: 'src',
  userId: 'u1',
  title: 'Étude',
  storageKey: 'scores/u1/1.musicxml',
} as Score;

function makeService(
  t: SubscriptionTier,
  existingScores: number,
  cached: Record<string, unknown> | null = { partList: {}, parts: [] },
) {
  const scoreRepo = {
    create: vi.fn((data: Partial<Score>) => data as Score),
    save: vi.fn((score: Score) => Promise.resolve({ ...score, id: 's1' })),
    countBy: vi.fn(() => Promise.resolve(existingScores)),
    findOneBy: vi.fn(({ id }: { id: string }) =>
      Promise.resolve(id === SOURCE.id ? { ...SOURCE } : null),
    ),
  };
  const cache = {
    upsert: vi.fn(() => Promise.resolve()),
    findByScoreId: vi.fn(() =>
      Promise.resolve(cached ? { scoreId: SOURCE.id, data: cached } : null),
    ),
  };
  const subscriptions = { tierFor: vi.fn(() => Promise.resolve(t)) };

  const storage = {
    read: vi.fn(() => Promise.resolve('{"partList":{},"parts":[],"stored":true}')),
  };

  const service = new ScoresService(
    scoreRepo as unknown as Repository<Score>,
    cache as unknown as CacheService,
    storage as unknown as StorageService,
    subscriptions as unknown as SubscriptionsService,
  );
  return { service, scoreRepo, cache, storage };
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

describe('duplicate', () => {
  it('copies the cached document into a new score titled "(copy)"', async () => {
    const { service, scoreRepo, cache, storage } = makeService(tier(5), 1, {
      partList: {},
      parts: [{ id: 'P1', measures: [] }],
    });
    const copy = await service.duplicate('u1', 'src');
    expect(copy.id).toBe('s1');
    expect(copy.title).toBe('Étude (copy)');
    expect(scoreRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'u1', title: 'Étude (copy)' }),
    );
    // The copy gets its own storage key rather than sharing the source file.
    const created = scoreRepo.create.mock.calls[0][0];
    expect(created.storageKey).not.toBe(SOURCE.storageKey);
    expect(cache.upsert).toHaveBeenCalledWith('s1', {
      partList: {},
      parts: [{ id: 'P1', measures: [] }],
    });
    expect(storage.read).not.toHaveBeenCalled();
  });

  it('falls back to the stored file when the source is not in the edit cache', async () => {
    const { service, cache, storage } = makeService(tier(null), 1, null);
    await service.duplicate('u1', 'src');
    expect(storage.read).toHaveBeenCalledWith(SOURCE.storageKey);
    // load() re-caches the source, then the copy is cached under the new id.
    expect(cache.upsert).toHaveBeenCalledWith('s1', {
      partList: {},
      parts: [],
      stored: true,
    });
  });

  it('counts against the plan cap like a create', async () => {
    const { service, scoreRepo } = makeService(tier(5), 5);
    await expect(service.duplicate('u1', 'src')).rejects.toMatchObject({
      response: { code: 'score-limit' },
    });
    expect(scoreRepo.save).not.toHaveBeenCalled();
  });

  it("refuses to copy another user's score", async () => {
    const { service, scoreRepo } = makeService(tier(null), 1);
    await expect(service.duplicate('u2', 'src')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(scoreRepo.save).not.toHaveBeenCalled();
  });

  it('404s on an unknown source', async () => {
    const { service } = makeService(tier(null), 1);
    await expect(service.duplicate('u1', 'nope')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('keeps the copy title within the 200-character column', async () => {
    const { service, scoreRepo } = makeService(tier(null), 1);
    scoreRepo.findOneBy.mockResolvedValueOnce({ ...SOURCE, title: 'x'.repeat(200) });
    const copy = await service.duplicate('u1', 'src');
    expect(copy.title).toHaveLength(200);
    expect(copy.title.endsWith(' (copy)')).toBe(true);
  });
});
