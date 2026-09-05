import 'reflect-metadata'

import { ForbiddenException, NotFoundException } from '@nestjs/common'
import { describe, expect, it, vi } from 'vitest'

import type { CacheService } from '../../src/cache/cache.service'
import type { Score } from '../../src/scores/entities/score.entity'
import { ScoresService } from '../../src/scores/scores.service'
import type { StorageService } from '../../src/storage/storage.service'
import type { SubscriptionsService } from '../../src/subscriptions/subscriptions.service'

vi.mock('../../src/scores/entities/score.entity', () => ({ Score: class Score {} }))
vi.mock('../../src/cache/cache.service', () => ({ CacheService: class CacheService {} }))
vi.mock('../../src/storage/storage.service', () => ({ StorageService: class StorageService {} }))

/** Read-only share links: minting, idempotence, revocation, and the public lookup. */

function makeService(scores: Score[]) {
    const repo = {
        findOneBy: vi.fn((where: Partial<Score>) =>
            Promise.resolve(scores.find((s) => Object.entries(where).every(([k, v]) => s[k as keyof Score] === v)) ?? null),
        ),
        save: vi.fn((score: Score) => Promise.resolve(score)),
    }
    const cache = { findByScoreId: vi.fn((id: string) => Promise.resolve({ scoreId: id, data: { cached: id } })), upsert: vi.fn() }
    const service = new ScoresService(
        repo as never,
        cache as unknown as CacheService,
        { read: vi.fn() } as unknown as StorageService,
        {} as SubscriptionsService,
    )
    return { service, repo }
}

const score = (overrides: Partial<Score>): Score =>
    ({
        id: 's1',
        userId: 'u1',
        title: 'Étude',
        storageKey: 'k',
        shareToken: null,
        updatedAt: new Date('2026-09-05T00:00:00Z'),
        ...overrides,
    }) as Score

describe('ScoresService share links', () => {
    it('mints a url-safe token once and keeps it on repeated share calls', async () => {
        const s = score({})
        const { service, repo } = makeService([s])
        const first = await service.share('u1', 's1')
        expect(first.token).toMatch(/^[A-Za-z0-9_-]{16}$/)
        expect(ScoresService.isShareToken(first.token)).toBe(true)
        expect(repo.save).toHaveBeenCalledTimes(1)

        const second = await service.share('u1', 's1')
        expect(second.token).toBe(first.token)
        expect(repo.save).toHaveBeenCalledTimes(1) // nothing to persist
    })

    it('only the owner can share or unshare', async () => {
        const { service } = makeService([score({})])
        await expect(service.share('u2', 's1')).rejects.toBeInstanceOf(ForbiddenException)
        await expect(service.unshare('u2', 's1')).rejects.toBeInstanceOf(ForbiddenException)
        await expect(service.share('u1', 'nope')).rejects.toBeInstanceOf(NotFoundException)
    })

    it('unshare clears the token (no-op when not shared) and a new share mints a different one', async () => {
        const s = score({ shareToken: 'abcdefghijklmnop' })
        const { service, repo } = makeService([s])
        await service.unshare('u1', 's1')
        expect(s.shareToken).toBeNull()
        expect(repo.save).toHaveBeenCalledTimes(1)
        await service.unshare('u1', 's1')
        expect(repo.save).toHaveBeenCalledTimes(1)
        const { token } = await service.share('u1', 's1')
        expect(token).not.toBe('abcdefghijklmnop')
    })

    it('lets an admin revoke any share link, and 404s for unknown scores', async () => {
        const s = score({ shareToken: 'abcdefghijklmnop' })
        const { service, repo } = makeService([s])
        await service.revokeShare('s1')
        expect(s.shareToken).toBeNull()
        expect(repo.save).toHaveBeenCalledTimes(1)
        await service.revokeShare('s1') // already off: nothing written
        expect(repo.save).toHaveBeenCalledTimes(1)
        await expect(service.revokeShare('nope')).rejects.toBeInstanceOf(NotFoundException)
    })

    it('resolves a shared score to its title and live document, without the owner', async () => {
        const { service } = makeService([score({ shareToken: 'abcdefghijklmnop' })])
        const shared = await service.loadShared('abcdefghijklmnop')
        expect(shared).toEqual({ id: 's1', title: 'Étude', updatedAt: new Date('2026-09-05T00:00:00Z'), document: { cached: 's1' } })
        expect(shared).not.toHaveProperty('userId')
    })

    it('answers 404 alike for unknown, revoked and malformed tokens', async () => {
        const { service, repo } = makeService([score({ shareToken: null })])
        await expect(service.loadShared('abcdefghijklmnop')).rejects.toBeInstanceOf(NotFoundException)
        await expect(service.loadShared("' OR 1=1 --")).rejects.toBeInstanceOf(NotFoundException)
        await expect(service.loadShared('short')).rejects.toBeInstanceOf(NotFoundException)
        // Malformed tokens never reach the database.
        expect(repo.findOneBy).toHaveBeenCalledTimes(1)
    })
})
