import { Controller, Get, Param, Post, UseGuards } from '@nestjs/common';

import { AdminGuard } from '../auth/admin.guard';
import { BetaService } from './beta.service';

/** Admin-only management of the closed-beta waitlist. */
@Controller('admin/beta')
@UseGuards(AdminGuard)
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
