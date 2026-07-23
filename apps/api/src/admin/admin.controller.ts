import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { FastifyReply } from 'fastify';

import { AdminService } from './admin.service';
import { AdminSecretGuard } from './admin-secret.guard';
import { AdjustCreditsDto } from './dto/adjust-credits.dto';

/**
 * Backend of the standalone admin console (apps/admin). Guarded by the shared
 * console secret, not by user sessions — see AdminSecretGuard.
 */
@Controller('admin')
@UseGuards(AdminSecretGuard)
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  @Get('stats')
  stats() {
    return this.adminService.stats();
  }

  @Get('users')
  users(
    @Query('search') search?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.adminService.listUsers({
      search,
      page: page ? Number(page) : undefined,
      pageSize: pageSize ? Number(pageSize) : undefined,
    });
  }

  @Get('users/:id')
  user(@Param('id') id: string) {
    return this.adminService.getUser(id);
  }

  @Get('users/:id/scores')
  userScores(@Param('id') id: string) {
    return this.adminService.listUserScores(id);
  }

  @Post('users/:id/credits')
  adjustCredits(@Param('id') id: string, @Body() dto: AdjustCreditsDto) {
    return this.adminService.adjustCredits(id, dto.seconds);
  }

  @Delete('users/:id/sessions')
  revokeSessions(@Param('id') id: string) {
    return this.adminService.revokeSessions(id);
  }

  @Get('scores/:id')
  score(@Param('id', ParseUUIDPipe) id: string) {
    return this.adminService.getScore(id);
  }

  /** Replay a recording: redirect to a signed bucket URL when the backend
   *  has one, otherwise stream the archived audio. */
  @Get('recordings/:id/audio')
  async recordingAudio(@Param('id', ParseUUIDPipe) id: string, @Res() reply: FastifyReply) {
    const audio = await this.adminService.recordingAudio(id);
    if ('url' in audio) {
      return reply.redirect(audio.url, 302);
    }
    return reply.type(audio.contentType).send(audio.stream);
  }

  @Get('tiers')
  tiers() {
    return this.adminService.listTiers();
  }
}
