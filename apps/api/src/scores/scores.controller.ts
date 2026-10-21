import { Body, Controller, Delete, Get, HttpStatus, Param, ParseUUIDPipe, Patch, Post, Query, UseGuards } from '@nestjs/common'

import { AuthGuard } from '../auth/auth.guard'
import { CurrentUser } from '../auth/user.decorator'
import { BetaApprovalGuard } from '../beta/beta-approval.guard'
import { CreateScoreDto } from './dto/create-score.dto'
import { UpdateScoreDto } from './dto/update-score.dto'
import { ScoresService } from './scores.service'

/** A malformed score id names no score: answer the same 404 as an unknown one (the editor's not-found screen),
 *  instead of a 500 from the uuid column. */
const SCORE_ID_PIPE = new ParseUUIDPipe({ errorHttpStatusCode: HttpStatus.NOT_FOUND })

@Controller('scores')
@UseGuards(AuthGuard, BetaApprovalGuard)
export class ScoresController {
    constructor(private readonly scoresService: ScoresService) {}

    @Post()
    create(@CurrentUser() user: { id: string }, @Body() dto: CreateScoreDto) {
        return this.scoresService.create(user.id, dto)
    }

    @Get()
    findAll(@CurrentUser() user: { id: string }, @Query('search') search?: string) {
        return this.scoresService.findAll(user.id, search)
    }

    @Get(':id')
    findOne(@CurrentUser() user: { id: string }, @Param('id', SCORE_ID_PIPE) id: string) {
        return this.scoresService.findOne(user.id, id)
    }

    @Get(':id/load')
    load(@CurrentUser() user: { id: string }, @Param('id', SCORE_ID_PIPE) id: string) {
        return this.scoresService.load(user.id, id)
    }

    @Post(':id/duplicate')
    duplicate(@CurrentUser() user: { id: string }, @Param('id', SCORE_ID_PIPE) id: string) {
        return this.scoresService.duplicate(user.id, id)
    }

    /** Turn the read-only share link on (idempotent) — answers the token to build `/s/<token>` from. */
    @Post(':id/share')
    share(@CurrentUser() user: { id: string }, @Param('id', SCORE_ID_PIPE) id: string) {
        return this.scoresService.share(user.id, id)
    }

    /** Turn the share link off; it stops resolving at once. */
    @Delete(':id/share')
    unshare(@CurrentUser() user: { id: string }, @Param('id', SCORE_ID_PIPE) id: string) {
        return this.scoresService.unshare(user.id, id)
    }

    @Patch(':id')
    update(@CurrentUser() user: { id: string }, @Param('id', SCORE_ID_PIPE) id: string, @Body() dto: UpdateScoreDto) {
        return this.scoresService.update(user.id, id, dto)
    }

    @Delete(':id')
    remove(@CurrentUser() user: { id: string }, @Param('id', SCORE_ID_PIPE) id: string) {
        return this.scoresService.remove(user.id, id)
    }
}
