import { Module } from '@nestjs/common';

import { BetaController } from './beta.controller';
import { BetaService } from './beta.service';
import { BetaAdminController } from './beta-admin.controller';
import { BetaApprovalGuard } from './beta-approval.guard';

@Module({
  controllers: [BetaController, BetaAdminController],
  providers: [BetaService, BetaApprovalGuard],
  exports: [BetaService, BetaApprovalGuard],
})
export class BetaModule {}
