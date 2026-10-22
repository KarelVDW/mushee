import { Module } from '@nestjs/common'

import { RecordingsModule } from '../recordings/recordings.module'
import { ScoresModule } from '../scores/scores.module'
import { AdminController } from './admin.controller'
import { AdminService } from './admin.service'
import { AnnouncementsController } from './announcements.controller'
import { AnnouncementsService } from './announcements.service'

@Module({
    imports: [ScoresModule, RecordingsModule],
    controllers: [AdminController, AnnouncementsController],
    providers: [AdminService, AnnouncementsService],
})
export class AdminModule {}
