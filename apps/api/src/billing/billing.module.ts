import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { RecordingsModule } from '../recordings/recordings.module';
import { SubscriptionsModule } from '../subscriptions/subscriptions.module';
import { BillingController } from './billing.controller';
import { BillingService } from './billing.service';
import { ProcessedWebhookEvent } from './entities/processed-webhook-event.entity';
import { PolarWebhookController } from './polar-webhook.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([ProcessedWebhookEvent]),
    SubscriptionsModule,
    RecordingsModule,
  ],
  controllers: [BillingController, PolarWebhookController],
  providers: [BillingService],
  exports: [BillingService],
})
export class BillingModule {}
