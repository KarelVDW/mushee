import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';

import { AuthGuard } from '../auth/auth.guard';
import { CurrentUser } from '../auth/user.decorator';
import { AccountService } from './account.service';
import { RequestDeletionDto } from './dto/request-deletion.dto';

@Controller('account')
@UseGuards(AuthGuard)
export class AccountController {
  constructor(private readonly accountService: AccountService) {}

  /** Soft-delete: starts the 7-day grace period and signs the user out everywhere. */
  @Post('delete')
  requestDeletion(
    @CurrentUser() user: { id: string },
    @Body() dto: RequestDeletionDto,
  ) {
    return this.accountService.requestDeletion(user.id, dto.password);
  }

  @Get('deletion')
  status(@CurrentUser() user: { id: string }) {
    return this.accountService.status(user.id);
  }

  @Post('reactivate')
  reactivate(@CurrentUser() user: { id: string }) {
    return this.accountService.reactivate(user.id);
  }
}
