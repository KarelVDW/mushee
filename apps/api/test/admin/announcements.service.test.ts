import 'reflect-metadata'

import { BadGatewayException, BadRequestException, NotFoundException } from '@nestjs/common'
import type { DataSource } from 'typeorm'
import { describe, expect, it, vi } from 'vitest'

import { AnnouncementsService } from '../../src/admin/announcements.service'
import type { AnnouncementRecipient, MailService } from '../../src/mail/mail.service'

function makeService(overrides?: { query?: ReturnType<typeof vi.fn> }) {
    const query = overrides?.query ?? vi.fn(() => Promise.resolve([]))
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
    const service = new AnnouncementsService({ query } as unknown as DataSource, mail as unknown as MailService)
    return { service, query, mail }
}

describe('AnnouncementsService', () => {
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
