import 'reflect-metadata'

import type { Repository } from 'typeorm'
import { describe, expect, it, vi } from 'vitest'

import type { CachedScore } from '../../src/scores/entities/cached-score.entity'
import { ScoreEditCacheService } from '../../src/scores/score-edit-cache.service'

vi.mock('../../src/scores/entities/cached-score.entity', () => ({ CachedScore: class CachedScore {} }))

/**
 * The fake mirrors the postgres driver's raw-query contract: an UPDATE
 * resolves to a [rows, affectedRowCount] tuple (TypeORM's PostgresQueryRunner),
 * so a two-element array is always truthy and only the count tells a miss.
 */
function makeCache(affected: number) {
    const query = vi.fn((sql: string) => Promise.resolve(sql.trimStart().startsWith('UPDATE') ? [[], affected] : []))
    const cache = new ScoreEditCacheService({ query } as unknown as Repository<CachedScore>)
    return { cache, query }
}

describe('ScoreEditCacheService patches', () => {
    it('report a hit when the row exists', async () => {
        const { cache } = makeCache(1)
        await expect(cache.updateMeasures('s1', { 0: { number: 1 } })).resolves.toBe(true)
        await expect(cache.replaceAllMeasures('s1', [{ number: 1 }])).resolves.toBe(true)
        await expect(cache.updatePartList('s1', { scoreParts: [] })).resolves.toBe(true)
    })

    it('report a miss when no row matched', async () => {
        const { cache } = makeCache(0)
        await expect(cache.updateMeasures('s1', { 0: { number: 1 } })).resolves.toBe(false)
        await expect(cache.replaceAllMeasures('s1', [{ number: 1 }])).resolves.toBe(false)
        await expect(cache.updatePartList('s1', { scoreParts: [] })).resolves.toBe(false)
    })

    it('chain every measure into one atomic statement', async () => {
        const { cache, query } = makeCache(1)
        await cache.updateMeasures('s1', { 0: { number: 1 }, 3: { number: 4 } })
        expect(query).toHaveBeenCalledTimes(1)
        const [sql, params] = query.mock.calls[0] as unknown as [string, unknown[]]
        expect(sql).toContain(`jsonb_set(jsonb_set(data, '{parts,0,measures,0}', $2::jsonb), '{parts,0,measures,3}', $3::jsonb)`)
        expect(params).toEqual(['s1', '{"number":1}', '{"number":4}'])
    })

    it('refuse a measure index that is not a non-negative integer before touching the database', async () => {
        const { cache, query } = makeCache(1)
        await expect(cache.updateMeasures('s1', { '-1': {} })).rejects.toThrow(/Invalid measure index/)
        expect(query).not.toHaveBeenCalled()
    })
})

describe('ScoreEditCacheService.primeIfAbsent', () => {
    it('inserts without overwriting an existing row', async () => {
        const { cache, query } = makeCache(0)
        await cache.primeIfAbsent('s1', { parts: [] })
        const [sql, params] = query.mock.calls[0] as unknown as [string, unknown[]]
        expect(sql).toMatch(/ON CONFLICT \("scoreId"\) DO NOTHING/)
        expect(sql).not.toMatch(/DO UPDATE/)
        expect(params).toEqual(['s1', '{"parts":[]}'])
    })
})
