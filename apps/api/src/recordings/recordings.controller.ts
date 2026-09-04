import { Controller, Delete, Get, Param, ParseUUIDPipe, Query, Res, UseGuards } from '@nestjs/common'
import type { FastifyReply } from 'fastify'

import { AuthGuard } from '../auth/auth.guard'
import { CurrentUser } from '../auth/user.decorator'
import { BetaApprovalGuard } from '../beta/beta-approval.guard'
import { RecordingsService } from './recordings.service'

/**
 * A user's own takes: list them (per score or all), replay the archived audio,
 * delete one. The recording itself happens over the WebSocket gateway; this is
 * the "my recordings" surface the privacy policy's deletion promise needs a UI for.
 */
@Controller('recordings')
@UseGuards(AuthGuard, BetaApprovalGuard)
export class RecordingsController {
    constructor(private readonly recordings: RecordingsService) {}

    @Get()
    list(@CurrentUser() user: { id: string }, @Query('scoreId') scoreId?: string) {
        return this.recordings.listForUser(user.id, scoreId || undefined)
    }

    /** Redirect to a signed bucket URL when the storage backend has one, otherwise stream the audio. */
    @Get(':id/audio')
    async audio(@CurrentUser() user: { id: string }, @Param('id', ParseUUIDPipe) id: string, @Res() reply: FastifyReply) {
        const audio = await this.recordings.audioFor(user.id, id)
        if ('url' in audio) return reply.redirect(audio.url, 302)
        return reply.type(audio.contentType).send(audio.stream)
    }

    @Delete(':id')
    remove(@CurrentUser() user: { id: string }, @Param('id', ParseUUIDPipe) id: string) {
        return this.recordings.remove(user.id, id)
    }
}
