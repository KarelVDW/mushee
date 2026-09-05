import 'reflect-metadata'

import { BadGatewayException, BadRequestException, NotFoundException } from '@nestjs/common'
import type { DataSource } from 'typeorm'
import { describe, expect, it, vi } from 'vitest'

import { AdminService } from '../../src/admin/admin.service'
import type { AnnouncementRecipient, MailService } from '../../src/mail/mail.service'
import type { RecordingCreditsService } from '../../src/recordings/recording-credits.service'
import type { ScoresService } from '../../src/scores/scores.service'
import type { StorageService } from '../../src/storage/storage.service'

const balance = {
    tier: { id: 'free', name: 'Sketch', dailyRecordingCredits: 180 },
    used: 30,
    remaining: 150,
    packSeconds: 900,
    exhausted: false,
}

function makeService(overrides?: { query?: ReturnType<typeof vi.fn>; scores?: Partial<ScoresService>; storage?: Partial<StorageService> }) {
    const query =
        overrides?.query ??
        vi.fn((sql: string) => {
            if (sql.trimStart().startsWith('DELETE')) return Promise.resolve([[], 0])
            return Promise.resolve([])
        })
    const scoresService = {
        findOneInternal: vi.fn(() => Promise.resolve(null)),
        load: vi.fn(() => Promise.resolve({})),
        ...overrides?.scores,
    }
    const recordingCredits = {
        balance: vi.fn(() => Promise.resolve(balance)),
        grantPackSeconds: vi.fn(() => Promise.resolve()),
        revokePackSeconds: vi.fn(() => Promise.resolve()),
    }
    const storage = {
        list: vi.fn(() => Promise.resolve([] as string[])),
        signedUrl: vi.fn(() => Promise.resolve(null as string | null)),
        createReadStream: vi.fn(() => 'fake-stream'),
        ...overrides?.storage,
    }
    const mail = {
        sendAnnouncement: vi.fn((recipients: unknown[]) =>
            Promise.resolve({
                sent: recipients.length,
                failed: 0,
                failedRecipients: [] as AnnouncementRecipient[],
                errors: [] as string[],
            }),
        ),
    }
    const service = new AdminService(
        { query } as unknown as DataSource,
        scoresService as unknown as ScoresService,
        recordingCredits as unknown as RecordingCreditsService,
        storage as unknown as StorageService,
        mail as unknown as MailService,
    )
    return { service, query, scoresService, recordingCredits, storage, mail }
}

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
                findOneInternal: vi.fn(() => Promise.resolve({ ...score, shareToken: 'abcdefghijklmnop' })),
                load: vi.fn(() => Promise.resolve({ parts: [] })),
                revokeShare,
            } as unknown as Partial<ScoresService>,
        })
        expect((await service.getScore(score.id)).shareToken).toBe('abcdefghijklmnop')
        expect(await service.revokeShare(score.id)).toEqual({ shareToken: null })
        expect(revokeShare).toHaveBeenCalledWith(score.id)
    })

    it('returns the document loaded via the owner', async () => {
        const load = vi.fn(() => Promise.resolve({ parts: [] }))
        const { service } = makeService({
            scores: {
                findOneInternal: vi.fn(() => Promise.resolve(score)),
                load,
            } as unknown as Partial<ScoresService>,
        })
        const result = await service.getScore(score.id)
        expect(load).toHaveBeenCalledWith('u1', score.id)
        expect(result).toMatchObject({ title: 'Nocturne', document: { parts: [] }, documentError: null })
    })

    it('surfaces a load failure instead of failing the request', async () => {
        const { service } = makeService({
            scores: {
                findOneInternal: vi.fn(() => Promise.resolve(score)),
                load: vi.fn(() => Promise.reject(new Error('storage object missing'))),
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
            scores: { findOneInternal: vi.fn(() => Promise.resolve(score)) } as unknown as Partial<ScoresService>,
        })
        const result = await service.getScore(score.id)
        expect(result.recordings).toBe(rows)
    })
})

describe('AdminService.recordingAudio', () => {
    const RECORDING_ID = 'f6a7b0d0-0000-4000-8000-000000000002'
    const withRecording = (storagePath: string | null) =>
        vi.fn((sql: string) => Promise.resolve(sql.includes('FROM recordings') ? [{ storagePath }] : []))

    it('404s for unknown recordings and for recordings without archived audio', async () => {
        const { service } = makeService()
        await expect(service.recordingAudio(RECORDING_ID)).rejects.toBeInstanceOf(NotFoundException)

        const { service: noAudio } = makeService({ query: withRecording(null) })
        await expect(noAudio.recordingAudio(RECORDING_ID)).rejects.toBeInstanceOf(NotFoundException)
    })

    it('404s when the base path holds no audio object', async () => {
        const { service } = makeService({
            query: withRecording('recordings/u/s/r'),
            storage: { list: vi.fn(() => Promise.resolve(['recordings/u/s/r/debug.json'])) },
        })
        await expect(service.recordingAudio(RECORDING_ID)).rejects.toBeInstanceOf(NotFoundException)
    })

    it('prefers a signed bucket URL', async () => {
        const { service, storage } = makeService({
            query: withRecording('recordings/u/s/r'),
            storage: {
                list: vi.fn(() => Promise.resolve(['recordings/u/s/r/audio.webm'])),
                signedUrl: vi.fn(() => Promise.resolve('https://bucket/signed')),
            },
        })
        await expect(service.recordingAudio(RECORDING_ID)).resolves.toEqual({ url: 'https://bucket/signed' })
        expect(storage.createReadStream).not.toHaveBeenCalled()
    })

    it('streams with the right content type when the backend has no URLs', async () => {
        const { service } = makeService({
            query: withRecording('recordings/u/s/r'),
            storage: { list: vi.fn(() => Promise.resolve(['recordings/u/s/r/audio.mp3'])) },
        })
        await expect(service.recordingAudio(RECORDING_ID)).resolves.toEqual({
            stream: 'fake-stream',
            contentType: 'audio/mpeg',
        })
    })

    it('falls back to streaming when signing fails', async () => {
        const { service } = makeService({
            query: withRecording('recordings/u/s/r'),
            storage: {
                list: vi.fn(() => Promise.resolve(['recordings/u/s/r/audio.webm'])),
                signedUrl: vi.fn(() => Promise.reject(new Error('no signBlob permission'))),
            },
        })
        await expect(service.recordingAudio(RECORDING_ID)).resolves.toEqual({
            stream: 'fake-stream',
            contentType: 'audio/webm',
        })
    })
})

describe('AdminService audience + announcements', () => {
    const filters = (over: Record<string, unknown> = {}) => ({ ...over }) as never

    it('builds one WHERE from the filter and excludes deletion-requested accounts by default', async () => {
        const query = vi.fn((sql: string) =>
            Promise.resolve(sql.includes('count(*)::int AS total') ? [{ total: 7 }] : [{ email: 'a@x', name: 'A' }]),
        )
        const { service } = makeService({ query })
        const result = await service.audience(
            filters({
                tiers: ['beta'],
                betaStatus: 'approved',
                signedUpAfter: '2026-07-01T00:00:00.000Z',
                activeWithinDays: 30,
                verifiedOnly: true,
            }),
        )
        expect(result).toEqual({ total: 7, sample: [{ email: 'a@x', name: 'A' }] })
        const [sql, params] = query.mock.calls[0] as unknown as [string, unknown[]]
        expect(sql).toContain(`COALESCE(s."tierId", 'free') = ANY($1)`)
        expect(sql).toContain(`u."betaStatus" = $2`)
        expect(sql).toContain(`u."createdAt" >= $3`)
        expect(sql).toContain(`se."lastActiveAt" >= now() - ($4 || ' days')::interval`)
        expect(sql).toContain(`u."emailVerified" = true`)
        expect(sql).toContain(`ad."userId" IS NULL`)
        expect(params).toEqual([['beta'], 'approved', new Date('2026-07-01T00:00:00.000Z'), '30'])
        // Both statements (count + sample) use the very same WHERE and parameters.
        const [sampleSql, sampleParams] = query.mock.calls[1] as unknown as [string, unknown[]]
        expect(sampleSql).toContain(`ad."userId" IS NULL`)
        expect(sampleParams).toEqual(params)
    })

    it('with no filters reaches every non-deleting account; betaStatus none = NULL; deletion opt-in lifts the exclusion', async () => {
        const query = vi.fn((sql: string) => Promise.resolve(sql.includes('count(*)') ? [{ total: 0 }] : []))
        const { service } = makeService({ query })
        await service.audience(filters({}))
        expect((query.mock.calls[0] as unknown as [string])[0]).toMatch(/WHERE ad."userId" IS NULL$/)
        await service.audience(filters({ betaStatus: 'none', includeDeletionRequested: true }))
        const sql = (query.mock.calls[2] as unknown as [string])[0]
        expect(sql).toContain(`u."betaStatus" IS NULL`)
        expect(sql).not.toContain(`ad."userId" IS NULL`)
    })

    it('previews the rendered e-mail for a sample recipient', () => {
        const { service } = makeService()
        const preview = service.previewAnnouncement('Hi {{name}}', 'Dear {{name}}, **welcome**.')
        expect(preview.subject).toBe('Hi Ada')
        expect(preview.text).toContain('Dear Ada, welcome.')
        expect(preview.html).toContain('<p>Dear Ada, <strong>welcome</strong>.</p>')
    })

    it('exports the audience as CSV with quoting', async () => {
        const query = vi.fn(() =>
            Promise.resolve([
                {
                    email: 'a@x',
                    name: 'Ada "Countess" Lovelace, Esq.',
                    tier: 'beta',
                    betaStatus: 'approved',
                    createdAt: new Date('2026-07-01T00:00:00.000Z'),
                    lastActiveAt: null,
                },
            ]),
        )
        const { service } = makeService({ query })
        expect(await service.audienceCsv(filters({}))).toBe(
            'email,name,tier,betaStatus,signedUpAt,lastActiveAt\na@x,"Ada ""Countess"" Lovelace, Esq.",beta,approved,2026-07-01T00:00:00.000Z,\n',
        )
    })

    it('neutralises spreadsheet formula injection in exported cells', async () => {
        const query = vi.fn(() =>
            Promise.resolve([
                {
                    email: 'b@x',
                    name: '=HYPERLINK("http://evil")',
                    tier: 'free',
                    betaStatus: null,
                    createdAt: new Date(0),
                    lastActiveAt: null,
                },
            ]),
        )
        const { service } = makeService({ query })
        const csv = await service.audienceCsv(filters({}))
        expect(csv.split('\n')[1]).toBe(`b@x,"'=HYPERLINK(""http://evil"")",free,,1970-01-01T00:00:00.000Z,`)
    })

    it('a test send goes to the test address only and is recorded as such', async () => {
        const query = vi.fn((sql: string) =>
            Promise.resolve(
                sql.startsWith('INSERT')
                    ? [{ id: 'ann-1', sentAt: new Date('2026-09-05T08:00:00Z') }]
                    : [{ email: 'real@x', name: 'Real' }],
            ),
        )
        const { service, mail } = makeService({ query })
        const result = await service.sendAnnouncement({
            subject: 'Beta ends',
            body: 'Hello {{name}}',
            filters: filters({ tiers: ['beta'] }),
            testTo: 'me@solkey.io',
        } as never)
        expect(mail.sendAnnouncement).toHaveBeenCalledWith(
            [{ email: 'me@solkey.io', name: 'Test Recipient' }],
            'Beta ends',
            'Hello {{name}}',
        )
        expect(result).toEqual({
            id: 'ann-1',
            recipientCount: 1,
            failedCount: 0,
            errors: [],
            sentAt: new Date('2026-09-05T08:00:00Z'),
            testTo: 'me@solkey.io',
        })
        // No audience query ran for a test send; the log row carries the test address and the filter.
        expect(query.mock.calls.every(([sql]) => !sql.includes('FROM "user"'))).toBe(true)
        const [, params] = query.mock.calls[0] as unknown as [string, unknown[]]
        expect(params).toEqual(['Beta ends', 'Hello {{name}}', JSON.stringify({ tiers: ['beta'] }), 1, 0, '[]', 'me@solkey.io'])
    })

    it('a real send resolves the audience, hands every recipient to mail, and refuses an empty audience', async () => {
        const recipients = [
            { email: 'a@x', name: 'A' },
            { email: 'b@x', name: 'B' },
        ]
        const query = vi.fn((sql: string) => Promise.resolve(sql.startsWith('INSERT') ? [{ id: 'ann-2', sentAt: new Date() }] : recipients))
        const { service, mail } = makeService({ query })
        const result = await service.sendAnnouncement({
            subject: 'Beta ends',
            body: 'Hi {{name}}, ...',
            filters: filters({ tiers: ['beta'] }),
        } as never)
        expect(mail.sendAnnouncement).toHaveBeenCalledWith(recipients, 'Beta ends', 'Hi {{name}}, ...')
        expect(result.recipientCount).toBe(2)
        expect(result.testTo).toBeNull()

        const empty = makeService({ query: vi.fn(() => Promise.resolve([])) })
        await expect(
            empty.service.sendAnnouncement({ subject: 'x'.repeat(3), body: 'y'.repeat(10), filters: filters({}) } as never),
        ).rejects.toBeInstanceOf(BadRequestException)
        expect(empty.mail.sendAnnouncement).not.toHaveBeenCalled()
    })

    it('records a partial send with its failed count instead of failing the request', async () => {
        const recipients = Array.from({ length: 3 }, (_, i) => ({ email: `u${i}@x`, name: 'U' }))
        const query = vi.fn((sql: string) => Promise.resolve(sql.startsWith('INSERT') ? [{ id: 'ann-3', sentAt: new Date() }] : recipients))
        const { service, mail } = makeService({ query })
        mail.sendAnnouncement.mockResolvedValueOnce({
            sent: 2,
            failed: 1,
            failedRecipients: [recipients[2]],
            errors: ['1 recipients from u2@x: 429'],
        })
        const result = await service.sendAnnouncement({ subject: 'Beta ends', body: 'Hi {{name}}', filters: filters({}) } as never)
        expect(result.recipientCount).toBe(2)
        expect(result.failedCount).toBe(1)
        expect(result.errors).toEqual(['1 recipients from u2@x: 429'])
        const insert = query.mock.calls.find(([sql]) => sql.startsWith('INSERT')) as unknown as [string, unknown[]]
        expect(insert[1].slice(3)).toEqual([2, 1, JSON.stringify([recipients[2]]), null])
    })

    it('a run that reached nobody is still recorded, then reported as a gateway error', async () => {
        const query = vi.fn((sql: string) =>
            Promise.resolve(sql.startsWith('INSERT') ? [{ id: 'ann-4', sentAt: new Date() }] : [{ email: 'a@x', name: 'A' }]),
        )
        const { service, mail } = makeService({ query })
        mail.sendAnnouncement.mockResolvedValueOnce({
            sent: 0,
            failed: 1,
            failedRecipients: [{ email: 'a@x', name: 'A' }],
            errors: ['1 recipients from a@x: 401 Unauthorized'],
        })
        await expect(
            service.sendAnnouncement({ subject: 'Beta ends', body: 'Hi {{name}}', filters: filters({}) } as never),
        ).rejects.toBeInstanceOf(BadGatewayException)
        expect(query.mock.calls.some(([sql]) => sql.startsWith('INSERT'))).toBe(true)
    })

    it('retries to exactly the unreached accounts, as a new row, and empties the original list first', async () => {
        const failed = [
            { email: 'c@x', name: 'C' },
            { email: 'd@x', name: 'D' },
        ]
        const query = vi.fn((sql: string) => {
            if (sql.startsWith('SELECT subject'))
                return Promise.resolve([{ subject: 'Beta ends', body: 'Hi {{name}}', failedRecipients: failed }])
            if (sql.startsWith('INSERT')) return Promise.resolve([{ id: 'ann-6', sentAt: new Date() }])
            return Promise.resolve([])
        })
        const { service, mail } = makeService({ query })
        const result = await service.retryAnnouncement('ann-5')
        expect(mail.sendAnnouncement).toHaveBeenCalledWith(failed, 'Beta ends', 'Hi {{name}}')
        expect(result.recipientCount).toBe(2)
        const kinds = query.mock.calls.map(([sql]) => sql.split(' ')[0])
        expect(kinds).toEqual(['SELECT', 'UPDATE', 'INSERT'])
        const insert = query.mock.calls[2] as unknown as [string, unknown[]]
        expect(insert[1][2]).toBe(JSON.stringify({ retryOf: 'ann-5' }))
    })

    it('refuses to retry an announcement that reached everyone, and 404s unknown ids', async () => {
        const reached = makeService({
            query: vi.fn(() => Promise.resolve([{ subject: 'S', body: 'B', failedRecipients: [] }])),
        })
        await expect(reached.service.retryAnnouncement('ann-1')).rejects.toBeInstanceOf(BadRequestException)
        expect(reached.mail.sendAnnouncement).not.toHaveBeenCalled()
        const missing = makeService({ query: vi.fn(() => Promise.resolve([])) })
        await expect(missing.service.retryAnnouncement('nope')).rejects.toBeInstanceOf(NotFoundException)
    })
})
