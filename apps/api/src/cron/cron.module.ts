import { Module } from '@nestjs/common'

import { AccountModule } from '../account/account.module'
import { BillingModule } from '../billing/billing.module'
import { ScoresModule } from '../scores/scores.module'
import { CronService } from './cron.service'

@Module({
    imports: [AccountModule, ScoresModule, BillingModule],
    providers: [CronService],
})
export class CronModule {}
