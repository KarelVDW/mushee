import { Controller, Get, Param, Post, UseGuards } from '@nestjs/common';

import { AdminSecretGuard } from '../admin/admin-secret.guard';
import { BetaService } from './beta.service';

/** Closed-beta waitlist management for the admin console (apps/admin). */
@Controller('admin/beta')
@UseGuards(AdminSecretGuard)
export class BetaAdminController {
  constructor(private readonly betaService: BetaService) {}

  @Get('signups')
  list() {
    return this.betaService.listSignups();
  }

  @Post('signups/:userId/approve')
  approve(@Param('userId') userId: string) {
    return this.betaService.approve(userId);
  }

  @Post('signups/:userId/revoke')
  revoke(@Param('userId') userId: string) {
    return this.betaService.revoke(userId);
  }
}
