import { Controller, Get, Param, UseGuards } from '@nestjs/common'

import { ScoresService } from './scores.service'
import { SharedScoreRateLimitGuard } from './shared-score-rate-limit.guard'

/**
 * Public, unauthenticated: a score behind its share token, for the read-only
 * `/s/<token>` page. Rate-limited per IP more tightly than the rest of the API
 * (see SharedScoreRateLimitGuard); an unknown or revoked token is a plain 404.
 * Deliberately not under /scores so the auth guards there stay blanket.
 */
@Controller('shared')
@UseGuards(SharedScoreRateLimitGuard)
export class SharedScoresController {
    constructor(private readonly scoresService: ScoresService) {}

    @Get(':token')
    load(@Param('token') token: string) {
        return this.scoresService.loadShared(token)
    }
}
