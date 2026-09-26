import { DataSource } from 'typeorm'
import { describe, expect, it, vi } from 'vitest'

import { AdminService } from '../../src/admin/admin.service'
import { AudienceFilterDto } from '../../src/admin/dto/audience-filter.dto'
import type { MailService } from '../../src/mail/mail.service'
import type { RecordingCreditsService } from '../../src/recordings/recording-credits.service'
import type { ScoresService } from '../../src/scores/scores.service'
import type { StorageService } from '../../src/storage/storage.service'

/**
 * The audience CSV is opened in spreadsheets and fed to SendGrid Marketing
 * Campaigns, and `name` is typed by users. Seeded random names built from
 * quotes, commas, newlines, formula prefixes and unicode must survive an
 * RFC 4180 round trip cell-for-cell, and no exported cell may start with a
 * character a spreadsheet would execute.
 */

function mulberry32(seed: number): () => number {
    let a = seed >>> 0
    return () => {
        a = (a + 0x6d2b79f5) >>> 0
        let t = a
        t = Math.imul(t ^ (t >>> 15), t | 1)
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
}

const PIECES = ['Ada', 'Lovelace', '"', '""', ',', '\n', '\r\n', '=SUM(A1)', '+1', '-x', '@cmd', '\t', ' ', 'Ünïcödé', '🎵', "'", 'O’Neil']

function randomName(rng: () => number): string {
    const n = Math.floor(rng() * 6)
    return Array.from({ length: n }, () => PIECES[Math.floor(rng() * PIECES.length)]).join('')
}

/** Minimal RFC 4180 reader: quoted fields may contain commas, newlines and doubled quotes. */
function parseCsv(text: string): string[][] {
    const rows: string[][] = []
    let row: string[] = []
    let cell = ''
    let quoted = false
    for (let i = 0; i < text.length; i++) {
        const c = text[i]
        if (quoted) {
            if (c === '"') {
                if (text[i + 1] === '"') {
                    cell += '"'
                    i++
                } else quoted = false
            } else cell += c
        } else if (c === '"') quoted = true
        else if (c === ',') {
            row.push(cell)
            cell = ''
        } else if (c === '\n') {
            row.push(cell)
            rows.push(row)
            row = []
            cell = ''
        } else cell += c
    }
    if (cell || row.length) {
        row.push(cell)
        rows.push(row)
    }
    return rows
}

function service(rows: unknown[]): AdminService {
    const query = vi.fn(() => Promise.resolve(rows))
    return new AdminService(
        { query } as unknown as DataSource,
        {} as ScoresService,
        {} as RecordingCreditsService,
        {} as StorageService,
        {} as MailService,
    )
}

describe('audience CSV export — round trip + formula guard (fuzz)', () => {
    it('every seeded name survives an RFC 4180 round trip and no cell can execute', async () => {
        for (let seed = 1; seed <= 300; seed++) {
            const rng = mulberry32(seed)
            const rows = Array.from({ length: 1 + Math.floor(rng() * 5) }, (_, i) => ({
                email: `u${i}@x`,
                name: randomName(rng),
                tier: 'free',
                betaStatus: rng() < 0.5 ? null : 'approved',
                createdAt: new Date(1_700_000_000_000 + i),
                lastActiveAt: rng() < 0.5 ? null : new Date(1_700_000_000_000 + 60_000 * i),
            }))
            const csv = await service(rows).audienceCsv(new AudienceFilterDto())
            const parsed = parseCsv(csv)
            expect(parsed[0], `seed ${seed}`).toEqual(['email', 'name', 'tier', 'betaStatus', 'signedUpAt', 'lastActiveAt'])
            expect(parsed.length - 1, `seed ${seed}`).toBe(rows.length)
            rows.forEach((r, i) => {
                const [email, name, tier, betaStatus, signedUpAt, lastActiveAt] = parsed[i + 1]
                expect(email).toBe(r.email)
                // Formula-looking names get a leading apostrophe; everything else is exact.
                expect(name, `seed ${seed}: ${JSON.stringify(r.name)}`).toBe(/^[=+\-@\t\r]/.test(r.name) ? `'${r.name}` : r.name)
                expect(name).not.toMatch(/^[=+\-@\t\r]/)
                expect(tier).toBe('free')
                expect(betaStatus).toBe(r.betaStatus ?? '')
                expect(signedUpAt).toBe(r.createdAt.toISOString())
                expect(lastActiveAt).toBe(r.lastActiveAt?.toISOString() ?? '')
            })
        }
    })
})
