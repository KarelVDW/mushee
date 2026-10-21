import 'reflect-metadata'

import { describe, expect, it, vi } from 'vitest'

import { SharedScoreRateLimitGuard } from '../../src/scores/shared-score-rate-limit.guard'
import { SharedScoresController } from '../../src/scores/shared-scores.controller'

// The controller pulls in ScoresService and, through it, TypeORM entities and
// storage; mock them at the seam like the other score tests (vitest.config.ts).
// vi.mock is hoisted, so these apply to the whole file — hence a file of its own.
vi.mock('../../src/scores/entities/score.entity', () => ({ Score: class Score {} }))
vi.mock('../../src/scores/score-edit-cache.service', () => ({ ScoreEditCacheService: class ScoreEditCacheService {} }))
vi.mock('../../src/storage/storage.service', () => ({ StorageService: class StorageService {} }))

describe('SharedScoresController', () => {
    it('is bound to the per-IP share limiter via @UseGuards', () => {
        const guards = Reflect.getMetadata('__guards__', SharedScoresController) as unknown[]
        expect(guards).toContain(SharedScoreRateLimitGuard)
    })
})
