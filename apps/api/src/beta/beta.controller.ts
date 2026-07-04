import { Controller, Get, UseGuards } from '@nestjs/common';

import { AuthGuard } from '../auth/auth.guard';
import { CurrentUser } from '../auth/user.decorator';
import { BetaService } from './beta.service';

@Controller('beta')
@UseGuards(AuthGuard)
export class BetaController {
  constructor(private readonly betaService: BetaService) {}

  /** Fresh beta status for the signed-in user; the pending screen polls this. */
  @Get('status')
  status(@CurrentUser() user: { id: string }) {
    return this.betaService.statusFor(user.id);
  }
}
