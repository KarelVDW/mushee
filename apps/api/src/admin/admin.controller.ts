import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Post, Query, Res, UseGuards } from '@nestjs/common'
import type { FastifyReply } from 'fastify'

import { AdminService } from './admin.service'
import { AdminSecretGuard } from './admin-secret.guard'
import { AdjustCreditsDto } from './dto/adjust-credits.dto'
import { AudienceFilterDto, BETA_STATUS_FILTERS, type BetaStatusFilter } from './dto/audience-filter.dto'
import { SendAnnouncementDto } from './dto/send-announcement.dto'

/**
 * Backend of the standalone admin console (apps/admin). Guarded by the shared
 * console secret, not by user sessions — see AdminSecretGuard.
 */
@Controller('admin')
@UseGuards(AdminSecretGuard)
export class AdminController {
    constructor(private readonly adminService: AdminService) {}

    @Get('stats')
    stats() {
        return this.adminService.stats()
    }

    @Get('users')
    users(@Query('search') search?: string, @Query('page') page?: string, @Query('pageSize') pageSize?: string) {
        return this.adminService.listUsers({
            search,
            page: page ? Number(page) : undefined,
            pageSize: pageSize ? Number(pageSize) : undefined,
        })
    }

    @Get('users/:id')
    user(@Param('id') id: string) {
        return this.adminService.getUser(id)
    }

    @Get('users/:id/scores')
    userScores(@Param('id') id: string) {
        return this.adminService.listUserScores(id)
    }

    @Post('users/:id/credits')
    adjustCredits(@Param('id') id: string, @Body() dto: AdjustCreditsDto) {
        return this.adminService.adjustCredits(id, dto.seconds)
    }

    @Delete('users/:id/sessions')
    revokeSessions(@Param('id') id: string) {
        return this.adminService.revokeSessions(id)
    }

    @Get('scores/:id')
    score(@Param('id', ParseUUIDPipe) id: string) {
        return this.adminService.getScore(id)
    }

    /** Revoke a score's read-only share link (a reported or abusive link). */
    @Delete('scores/:id/share')
    revokeShare(@Param('id', ParseUUIDPipe) id: string) {
        return this.adminService.revokeShare(id)
    }

    /** Replay a recording: redirect to a signed bucket URL when the backend
     *  has one, otherwise stream the archived audio. */
    @Get('recordings/:id/audio')
    async recordingAudio(@Param('id', ParseUUIDPipe) id: string, @Res() reply: FastifyReply) {
        const audio = await this.adminService.recordingAudio(id)
        if ('url' in audio) {
            return reply.redirect(audio.url, 302)
        }
        return reply.type(audio.contentType).send(audio.stream)
    }

    @Get('tiers')
    tiers() {
        return this.adminService.listTiers()
    }

    // --- Audience + announcements (service e-mail to filtered accounts) ---

    /** Who a filter reaches — count and a sample — before anything is sent. */
    @Get('audience')
    audience(@Query() query: Record<string, string | undefined>) {
        return this.adminService.audience(AdminController.filtersFromQuery(query))
    }

    /** The same audience as a CSV download (for SendGrid Marketing Campaigns and the like). */
    @Get('audience/export.csv')
    async audienceCsv(@Query() query: Record<string, string | undefined>, @Res() reply: FastifyReply) {
        const csv = await this.adminService.audienceCsv(AdminController.filtersFromQuery(query))
        return reply
            .type('text/csv; charset=utf-8')
            .header('Content-Disposition', `attachment; filename="solkey-audience-${new Date().toISOString().slice(0, 10)}.csv"`)
            .send(csv)
    }

    @Post('announcements')
    sendAnnouncement(@Body() dto: SendAnnouncementDto) {
        return this.adminService.sendAnnouncement(dto)
    }

    @Get('announcements')
    announcements() {
        return this.adminService.listAnnouncements()
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
