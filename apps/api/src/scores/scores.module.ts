import { Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'

import { BetaModule } from '../beta/beta.module'
import { CacheModule } from '../cache/cache.module'
import { StorageModule } from '../storage/storage.module'
import { SubscriptionsModule } from '../subscriptions/subscriptions.module'
import { Score } from './entities/score.entity'
import { ScoresController } from './scores.controller'
import { ScoresService } from './scores.service'
import { SharedScoresController } from './shared-scores.controller'

@Module({
    imports: [TypeOrmModule.forFeature([Score]), BetaModule, CacheModule, StorageModule, SubscriptionsModule],
    controllers: [ScoresController, SharedScoresController],
    providers: [ScoresService],
    exports: [ScoresService],
})
export class ScoresModule {}
