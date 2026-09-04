import { Controller, Get, Param } from '@nestjs/common'

import { ScoresService } from './scores.service'

/**
 * Public, unauthenticated: a score behind its share token, for the read-only
 * `/s/<token>` page. Rate-limited like every route; an unknown or revoked token
 * is a plain 404. Deliberately not under /scores so the auth guards there stay
 * blanket.
 */
@Controller('shared')
export class SharedScoresController {
    constructor(private readonly scoresService: ScoresService) {}

    @Get(':token')
    load(@Param('token') token: string) {
        return this.scoresService.loadShared(token)
    }
}
