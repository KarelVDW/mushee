import { Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'

import { BetaModule } from '../beta/beta.module'
import { StorageModule } from '../storage/storage.module'
import { SubscriptionsModule } from '../subscriptions/subscriptions.module'
import { CachedScore } from './entities/cached-score.entity'
import { Score } from './entities/score.entity'
import { ScoreEditCacheService } from './score-edit-cache.service'
import { ScoresController } from './scores.controller'
import { ScoresService } from './scores.service'
import { SharedScoresController } from './shared-scores.controller'

@Module({
    imports: [TypeOrmModule.forFeature([Score, CachedScore]), BetaModule, StorageModule, SubscriptionsModule],
    controllers: [ScoresController, SharedScoresController],
    providers: [ScoresService, ScoreEditCacheService],
    exports: [ScoresService],
})
export class ScoresModule {}
