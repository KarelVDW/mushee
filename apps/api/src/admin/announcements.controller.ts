import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, Res, UseGuards } from '@nestjs/common'
import type { FastifyReply } from 'fastify'

import { AdminSecretGuard } from './admin-secret.guard'
import { AnnouncementsService } from './announcements.service'
import { AudienceFilterDto, BETA_STATUS_FILTERS, type BetaStatusFilter } from './dto/audience-filter.dto'
import { PreviewAnnouncementDto } from './dto/preview-announcement.dto'
import { SendAnnouncementDto } from './dto/send-announcement.dto'

/**
 * The admin console's audience + announcements routes (service e-mail to
 * filtered accounts). Same `admin` prefix and console-secret guard as
 * AdminController.
 */
@Controller('admin')
@UseGuards(AdminSecretGuard)
export class AnnouncementsController {
    constructor(private readonly announcementsService: AnnouncementsService) {}

    /** Who a filter reaches — count and a sample — before anything is sent. */
    @Get('audience')
    audience(@Query() query: Record<string, string | undefined>) {
        return this.announcementsService.audience(AnnouncementsController.filtersFromQuery(query))
    }

    /** The same audience as a CSV download (for SendGrid Marketing Campaigns and the like). */
    @Get('audience/export.csv')
    async audienceCsv(@Query() query: Record<string, string | undefined>, @Res() reply: FastifyReply) {
        const csv = await this.announcementsService.audienceCsv(AnnouncementsController.filtersFromQuery(query))
        return reply
            .type('text/csv; charset=utf-8')
            .header('Content-Disposition', `attachment; filename="solkey-audience-${new Date().toISOString().slice(0, 10)}.csv"`)
            .send(csv)
    }

    @Post('announcements')
    sendAnnouncement(@Body() dto: SendAnnouncementDto) {
        return this.announcementsService.sendAnnouncement(dto)
    }

    /** Resend a recorded announcement to exactly the accounts SendGrid rejected the first time. */
    @Post('announcements/:id/retry')
    retryAnnouncement(@Param('id', ParseUUIDPipe) id: string) {
        return this.announcementsService.retryAnnouncement(id)
    }

    /** The rendered e-mail (subject, plain text, HTML) for a sample recipient — what the console previews. */
    @Post('announcements/preview')
    previewAnnouncement(@Body() dto: PreviewAnnouncementDto) {
        return this.announcementsService.previewAnnouncement(dto.subject, dto.body)
    }

    @Get('announcements')
    announcements() {
        return this.announcementsService.listAnnouncements()
    }

    /** Query-string form of the audience filter (`tiers` comma-separated, booleans as 'true'). */
    static filtersFromQuery(query: Record<string, string | undefined>): AudienceFilterDto {
        const filters = new AudienceFilterDto()
        if (query.tiers)
            filters.tiers = query.tiers
                .split(',')
                .map((t) => t.trim())
                .filter(Boolean)
        if (query.betaStatus && (BETA_STATUS_FILTERS as readonly string[]).includes(query.betaStatus))
            filters.betaStatus = query.betaStatus as BetaStatusFilter
        if (query.signedUpAfter) filters.signedUpAfter = query.signedUpAfter
        if (query.signedUpBefore) filters.signedUpBefore = query.signedUpBefore
        if (query.activeWithinDays) {
            const days = Number(query.activeWithinDays)
            if (Number.isInteger(days) && days > 0) filters.activeWithinDays = days
        }
        filters.verifiedOnly = query.verifiedOnly === 'true'
        filters.includeDeletionRequested = query.includeDeletionRequested === 'true'
        return filters
    }
}
