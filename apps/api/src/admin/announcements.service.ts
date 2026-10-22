import { BadGatewayException, BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common'
import { InjectDataSource } from '@nestjs/typeorm'
import { DataSource } from 'typeorm'

import { type AnnouncementRecipient, MailService } from '../mail/mail.service'
import { AudienceFilterDto } from './dto/audience-filter.dto'
import { SendAnnouncementDto } from './dto/send-announcement.dto'

export interface AnnouncementOutcome {
    id: string
    recipientCount: number
    failedCount: number
    errors: string[]
    sentAt: Date
    testTo: string | null
}

/**
 * Service e-mail to filtered accounts, behind the admin console: preview who
 * a filter reaches, export it as CSV, send (or test-send) an announcement,
 * retry the recipients a run missed, and keep the history of every send.
 */
@Injectable()
export class AnnouncementsService {
    private readonly logger = new Logger(AnnouncementsService.name)

    constructor(
        @InjectDataSource() private readonly dataSource: DataSource,
        private readonly mail: MailService,
    ) {}

    /**
     * SQL for "the accounts matching this filter": one WHERE fragment shared by
     * the count/sample, the CSV export and the send, so what you previewed is
     * exactly who receives it. Parameters are positional from $1.
     */
    private audienceWhere(filters: AudienceFilterDto): { where: string; params: unknown[] } {
        const clauses: string[] = []
        const params: unknown[] = []
        const add = (clause: string, value: unknown) => {
            params.push(value)
            clauses.push(clause.replace('?', `$${params.length}`))
        }
        if (filters.tiers?.length) add(`COALESCE(s."tierId", 'free') = ANY(?)`, filters.tiers)
        if (filters.betaStatus && filters.betaStatus !== 'any') {
            if (filters.betaStatus === 'none') clauses.push(`u."betaStatus" IS NULL`)
            else add(`u."betaStatus" = ?`, filters.betaStatus)
        }
        if (filters.signedUpAfter) add(`u."createdAt" >= ?`, new Date(filters.signedUpAfter))
        if (filters.signedUpBefore) add(`u."createdAt" < ?`, new Date(filters.signedUpBefore))
        if (filters.activeWithinDays) add(`se."lastActiveAt" >= now() - (? || ' days')::interval`, String(filters.activeWithinDays))
        if (filters.verifiedOnly) clauses.push(`u."emailVerified" = true`)
        if (!filters.includeDeletionRequested) clauses.push(`ad."userId" IS NULL`)
        return { where: clauses.length ? `WHERE ${clauses.join(' AND ')}` : '', params }
    }

    private static readonly AUDIENCE_FROM = `FROM "user" u
       LEFT JOIN user_subscriptions s ON s."userId" = u.id
       LEFT JOIN (SELECT "userId", max("updatedAt") AS "lastActiveAt" FROM session GROUP BY 1) se ON se."userId" = u.id
       LEFT JOIN account_deletions ad ON ad."userId" = u.id`

    /** Who a filter reaches: the count plus a few addresses to eyeball. */
    async audience(filters: AudienceFilterDto): Promise<{ total: number; sample: AnnouncementRecipient[] }> {
        const { where, params } = this.audienceWhere(filters)
        const [{ total }]: Array<{ total: number }> = await this.dataSource.query(
            `SELECT count(*)::int AS total ${AnnouncementsService.AUDIENCE_FROM} ${where}`,
            params,
        )
        const sample: AnnouncementRecipient[] = await this.dataSource.query(
            `SELECT u.email, u.name ${AnnouncementsService.AUDIENCE_FROM} ${where} ORDER BY u."createdAt" DESC LIMIT 5`,
            params,
        )
        return { total, sample }
    }

    private async audienceRecipients(filters: AudienceFilterDto): Promise<AnnouncementRecipient[]> {
        const { where, params } = this.audienceWhere(filters)
        return this.dataSource.query(
            `SELECT u.email, u.name ${AnnouncementsService.AUDIENCE_FROM} ${where} ORDER BY u."createdAt" DESC`,
            params,
        )
    }

    /**
     * The audience as CSV (email, name, tier, beta status, signed up, last
     * active) — for anything marketing-shaped, which belongs in SendGrid
     * Marketing Campaigns (contact lists, unsubscribe groups, stats) rather
     * than in this console.
     */
    async audienceCsv(filters: AudienceFilterDto): Promise<string> {
        const { where, params } = this.audienceWhere(filters)
        const rows: Array<{
            email: string
            name: string
            tier: string
            betaStatus: string | null
            createdAt: Date
            lastActiveAt: Date | null
        }> = await this.dataSource.query(
            `SELECT u.email, u.name, COALESCE(s."tierId", 'free') AS tier, u."betaStatus", u."createdAt", se."lastActiveAt"
       ${AnnouncementsService.AUDIENCE_FROM} ${where} ORDER BY u."createdAt" DESC`,
            params,
        )
        const cell = (v: string | Date | null | undefined) => {
            let s = v instanceof Date ? v.toISOString() : (v ?? '')
            // Names are user-typed: a value starting with = + - @ would run as a formula when the
            // file is opened in a spreadsheet. A leading apostrophe makes it plain text there.
            if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`
            return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
        }
        const header = ['email', 'name', 'tier', 'betaStatus', 'signedUpAt', 'lastActiveAt']
        return (
            [
                header.join(','),
                ...rows.map((r) => [r.email, r.name, r.tier, r.betaStatus, r.createdAt, r.lastActiveAt].map(cell).join(',')),
            ].join('\n') + '\n'
        )
    }

    /**
     * Send (or test-send) an announcement and record the run. The record is
     * written even when SendGrid rejected some or all batches — `recipientCount`
     * is who actually got it, `failedCount`/`failedRecipients` who did not —
     * because a partial send that left no trace is exactly what leads to
     * double-sending on retry. Only a run that reached nobody is reported as an
     * error.
     */
    async sendAnnouncement(dto: SendAnnouncementDto): Promise<AnnouncementOutcome> {
        const recipients = dto.testTo ? [{ email: dto.testTo, name: 'Test Recipient' }] : await this.audienceRecipients(dto.filters)
        if (!dto.testTo && recipients.length === 0) throw new BadRequestException('Nobody matches this audience.')
        return this.deliverAnnouncement(recipients, dto.subject, dto.body, dto.filters, dto.testTo ?? null)
    }

    /**
     * Send a recorded announcement again, to exactly the accounts its run did
     * not reach. The retry is its own history row (filters `{ retryOf }`), and
     * the original row hands its failed recipients over so a second click
     * cannot resend to them twice.
     */
    async retryAnnouncement(id: string): Promise<AnnouncementOutcome> {
        const [row]: Array<{ subject: string; body: string; failedRecipients: AnnouncementRecipient[] }> = await this.dataSource.query(
            `SELECT subject, body, "failedRecipients" FROM announcements WHERE id = $1`,
            [id],
        )
        if (!row) throw new NotFoundException('Announcement not found.')
        if (!row.failedRecipients.length) throw new BadRequestException('Every recipient of this announcement was reached.')
        await this.dataSource.query(`UPDATE announcements SET "failedRecipients" = '[]'::jsonb WHERE id = $1`, [id])
        return this.deliverAnnouncement(row.failedRecipients, row.subject, row.body, { retryOf: id }, null)
    }

    private async deliverAnnouncement(
        recipients: AnnouncementRecipient[],
        subject: string,
        body: string,
        filters: unknown,
        testTo: string | null,
    ): Promise<AnnouncementOutcome> {
        const outcome = await this.mail.sendAnnouncement(recipients, subject, body)
        const [row]: Array<{ id: string; sentAt: Date }> = await this.dataSource.query(
            `INSERT INTO announcements (subject, body, filters, "recipientCount", "failedCount", "failedRecipients", "testTo")
             VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id, "sentAt"`,
            [subject, body, JSON.stringify(filters), outcome.sent, outcome.failed, JSON.stringify(outcome.failedRecipients), testTo],
        )
        this.logger.log(
            `Announcement "${subject}" sent to ${outcome.sent} recipient(s)${outcome.failed ? `, ${outcome.failed} not delivered` : ''}${testTo ? ` (test → ${testTo})` : ''}`,
        )
        if (outcome.sent === 0)
            throw new BadGatewayException(`SendGrid rejected the announcement (${outcome.errors[0] ?? 'no batch went out'}).`)
        return { id: row.id, recipientCount: outcome.sent, failedCount: outcome.failed, errors: outcome.errors, sentAt: row.sentAt, testTo }
    }

    /** Render for a sample recipient ("Ada") so the console can show the e-mail exactly as it will arrive. */
    previewAnnouncement(subject: string, body: string): { subject: string; text: string; html: string } {
        return MailService.previewAnnouncement(subject, body)
    }

    async listAnnouncements(): Promise<Array<Record<string, unknown>>> {
        return this.dataSource.query(
            `SELECT id, subject, body, filters, "recipientCount", "failedCount",
                    jsonb_array_length("failedRecipients")::int AS "retryable", "testTo", "sentAt" FROM announcements ORDER BY "sentAt" DESC LIMIT 100`,
        )
    }
}
