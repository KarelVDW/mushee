import { Body, Controller, Get, Put, UseGuards } from '@nestjs/common';

import { AuthGuard } from '../auth/auth.guard';
import { CurrentUser } from '../auth/user.decorator';
import { PutKeyboardShortcutsDto } from './dto/put-keyboard-shortcuts.dto';
import { SettingsService } from './settings.service';

@Controller('settings')
@UseGuards(AuthGuard)
export class SettingsController {
  constructor(private readonly settingsService: SettingsService) {}

  @Get()
  get(@CurrentUser() user: { id: string }) {
    return this.settingsService.get(user.id);
  }

  @Put('keyboard-shortcuts')
  putKeyboardShortcuts(
    @CurrentUser() user: { id: string },
    @Body() dto: PutKeyboardShortcutsDto,
  ) {
    return this.settingsService.setKeyboardShortcuts(
      user.id,
      dto.keyboardShortcuts,
    );
  }
}
