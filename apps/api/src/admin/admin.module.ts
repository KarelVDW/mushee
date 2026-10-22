import { Module } from '@nestjs/common'

import { RecordingsModule } from '../recordings/recordings.module'
import { ScoresModule } from '../scores/scores.module'
import { AdminController } from './admin.controller'
import { AdminService } from './admin.service'

@Module({
    imports: [ScoresModule, RecordingsModule],
    controllers: [AdminController],
    providers: [AdminService],
})
export class AdminModule {}
