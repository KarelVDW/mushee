import 'reflect-metadata'

import { BadRequestException, NotFoundException } from '@nestjs/common'
import type { DataSource } from 'typeorm'
import { describe, expect, it, vi } from 'vitest'

import { AdminService } from '../../src/admin/admin.service'
import type { RecordingCreditsService } from '../../src/recordings/recording-credits.service'
import type { ScoresService } from '../../src/scores/scores.service'

const balance = {
    tier: { id: 'free', name: 'Sketch', dailyRecordingCredits: 180 },
    used: 30,
    remaining: 150,
    packSeconds: 900,
    exhausted: false,
}

function makeService(overrides?: { query?: ReturnType<typeof vi.fn>; scores?: Partial<ScoresService> }) {
    const query =
        overrides?.query ??
        vi.fn((sql: string) => {
            if (sql.trimStart().startsWith('DELETE')) return Promise.resolve([[], 0])
            return Promise.resolve([])
        })
    const scoresService = {
        findById: vi.fn(() => Promise.resolve(null)),
        readDocument: vi.fn(() => Promise.resolve({})),
        ...overrides?.scores,
    }
    const recordingCredits = {
        balance: vi.fn(() => Promise.resolve(balance)),
        grantPackSeconds: vi.fn(() => Promise.resolve()),
        revokePackSeconds: vi.fn(() => Promise.resolve()),
    }
    const service = new AdminService(
        { query } as unknown as DataSource,
        scoresService as unknown as ScoresService,
        recordingCredits as unknown as RecordingCreditsService,
    )
    return { service, query, scoresService, recordingCredits }
}

describe('AdminService.stats', () => {
    it('reports users per plan from the Tiers page count, leaving out empty tiers', async () => {
        const tierRows = [
            { id: 'free', name: 'Sketch', dailyRecordingCredits: 180, maxScores: 3, sortOrder: 0, sellable: true, userCount: 12 },
            { id: 'pro', name: 'Songwriter', dailyRecordingCredits: 1800, maxScores: null, sortOrder: 1, sellable: true, userCount: 0 },
            { id: 'beta', name: 'Beta', dailyRecordingCredits: 1800, maxScores: null, sortOrder: 9, sellable: false, userCount: 4 },
        ]
        const query = vi.fn((sql: string) => {
            if (sql.includes('FROM subscription_tiers t')) return Promise.resolve(tierRows)
            if (sql.includes('generate_series')) return Promise.resolve([])
            return Promise.resolve([{ users: 16 }])
        })
        const { service } = makeService({ query })

        const { tiers } = await service.stats()

        expect(tiers).toEqual([
            { id: 'free', name: 'Sketch', users: 12 },
            { id: 'beta', name: 'Beta', users: 4 },
        ])
        await expect(service.listTiers()).resolves.toBe(tierRows)
    })
})

describe('AdminService.listUsers', () => {
    it('clamps page and pageSize and escapes LIKE wildcards', async () => {
        const query = vi.fn((sql: string) => Promise.resolve(sql.includes('count(*)::int AS total') ? [{ total: 0 }] : []))
        const { service } = makeService({ query })

        const result = await service.listUsers({ search: '100%_a\\b', page: -3, pageSize: 9999 })

        expect(result).toMatchObject({ page: 1, pageSize: 100, total: 0, users: [] })
        const [, params] = query.mock.calls[0] as unknown as [string, unknown[]]
        expect(params[0]).toBe('100%_a\\b')
        expect(params[1]).toBe('%100\\%\\_a\\\\b%')
        expect(params[2]).toBe(100) // LIMIT
        expect(params[3]).toBe(0) // OFFSET
    })

    it('passes paging through untouched when already sane', async () => {
        const query = vi.fn((sql: string) => Promise.resolve(sql.includes('count(*)::int AS total') ? [{ total: 42 }] : []))
        const { service } = makeService({ query })

        const result = await service.listUsers({ page: 3, pageSize: 10 })

        expect(result).toMatchObject({ page: 3, pageSize: 10, total: 42 })
        const [, params] = query.mock.calls[0] as unknown as [string, unknown[]]
        expect(params[3]).toBe(20) // OFFSET = (page-1) * pageSize
    })
})

describe('AdminService.adjustCredits', () => {
    const existingUser = vi.fn((sql: string) => Promise.resolve(sql.includes('SELECT id FROM "user"') ? [{ id: 'u1' }] : []))

    it('grants positive amounts through the pack balance', async () => {
        const { service, recordingCredits } = makeService({ query: existingUser })
        const state = await service.adjustCredits('u1', 600)
        expect(recordingCredits.grantPackSeconds).toHaveBeenCalledWith('u1', 600)
        expect(recordingCredits.revokePackSeconds).not.toHaveBeenCalled()
        expect(state).toEqual({
            tierId: 'free',
            tierName: 'Sketch',
            dailyLimit: 180,
            usedToday: 30,
            remainingToday: 150,
            packSeconds: 900,
        })
    })

    it('revokes negative amounts', async () => {
        const { service, recordingCredits } = makeService({ query: existingUser })
        await service.adjustCredits('u1', -300)
        expect(recordingCredits.revokePackSeconds).toHaveBeenCalledWith('u1', 300)
        expect(recordingCredits.grantPackSeconds).not.toHaveBeenCalled()
    })

    it('rejects zero and non-integer amounts', async () => {
        const { service } = makeService({ query: existingUser })
        await expect(service.adjustCredits('u1', 0)).rejects.toBeInstanceOf(BadRequestException)
        await expect(service.adjustCredits('u1', 1.5)).rejects.toBeInstanceOf(BadRequestException)
    })

    it('404s for unknown users', async () => {
        const { service } = makeService() // query resolves to no rows
        await expect(service.adjustCredits('ghost', 60)).rejects.toBeInstanceOf(NotFoundException)
    })
})

describe('AdminService.revokeSessions', () => {
    it('reports how many sessions were dropped', async () => {
        const query = vi.fn((sql: string) => {
            if (sql.includes('SELECT id FROM "user"')) return Promise.resolve([{ id: 'u1' }])
            if (sql.trimStart().startsWith('DELETE')) return Promise.resolve([[{ id: 's1' }, { id: 's2' }], 2])
            return Promise.resolve([])
        })
        const { service } = makeService({ query })
        await expect(service.revokeSessions('u1')).resolves.toEqual({ revoked: 2 })
    })
})

describe('AdminService.getScore', () => {
    const score = {
        id: 'f6a7b0d0-0000-4000-8000-000000000001',
        userId: 'u1',
        title: 'Nocturne',
        storageKey: 'scores/u1/1.musicxml',
        createdAt: new Date('2026-01-01'),
        updatedAt: new Date('2026-01-02'),
    }

    it('404s for unknown scores', async () => {
        const { service } = makeService()
        await expect(service.getScore(score.id)).rejects.toBeInstanceOf(NotFoundException)
    })

    it('reports the share-link state and revokes it through the scores service', async () => {
        const revokeShare = vi.fn(() => Promise.resolve())
        const { service } = makeService({
            scores: {
                findById: vi.fn(() => Promise.resolve({ ...score, shareToken: 'abcdefghijklmnop' })),
                readDocument: vi.fn(() => Promise.resolve({ parts: [] })),
                revokeShare,
            } as unknown as Partial<ScoresService>,
        })
        expect((await service.getScore(score.id)).shareToken).toBe('abcdefghijklmnop')
        expect(await service.revokeShare(score.id)).toEqual({ shareToken: null })
        expect(revokeShare).toHaveBeenCalledWith(score.id)
    })

    it('returns the document through the read-only path, without an editing load', async () => {
        const readDocument = vi.fn(() => Promise.resolve({ parts: [] }))
        const load = vi.fn(() => Promise.resolve({}))
        const { service } = makeService({
            scores: {
                findById: vi.fn(() => Promise.resolve(score)),
                readDocument,
                load,
            } as unknown as Partial<ScoresService>,
        })
        const result = await service.getScore(score.id)
        expect(readDocument).toHaveBeenCalledWith(score)
        // load() would prime the edit cache, which the flush cron then rewrites to storage for nothing.
        expect(load).not.toHaveBeenCalled()
        expect(result).toMatchObject({ title: 'Nocturne', document: { parts: [] }, documentError: null })
    })

    it('surfaces a load failure instead of failing the request', async () => {
        const { service } = makeService({
            scores: {
                findById: vi.fn(() => Promise.resolve(score)),
                readDocument: vi.fn(() => Promise.reject(new Error('storage object missing'))),
            } as unknown as Partial<ScoresService>,
        })
        const result = await service.getScore(score.id)
        expect(result).toMatchObject({ document: null, documentError: 'storage object missing' })
    })

    it("lists the score's recordings, newest first", async () => {
        const rows = [{ id: 'r2', creditsSpent: 30, hasAudio: true }]
        const query = vi.fn((sql: string) => Promise.resolve(sql.includes('FROM recordings') ? rows : []))
        const { service } = makeService({
            query,
            scores: { findById: vi.fn(() => Promise.resolve(score)) } as unknown as Partial<ScoresService>,
        })
        const result = await service.getScore(score.id)
        expect(result.recordings).toBe(rows)
    })
})
