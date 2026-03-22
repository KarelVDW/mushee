import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';

import { AuthGuard } from '../auth/auth.guard';
import { CurrentUser } from '../auth/user.decorator';
import { CreateScoreDto } from './dto/create-score.dto';
import { UpdateScoreDto } from './dto/update-score.dto';
import { ScoresService } from './scores.service';

@Controller('scores')
@UseGuards(AuthGuard)
export class ScoresController {
  constructor(private readonly scoresService: ScoresService) {}

  @Post()
  create(
    @CurrentUser() user: { id: string },
    @Body() dto: CreateScoreDto,
  ) {
    return this.scoresService.create(user.id, dto);
  }

  @Get()
  findAll(
    @CurrentUser() user: { id: string },
    @Query('search') search?: string,
  ) {
    return this.scoresService.findAll(user.id, search);
  }

  @Get(':id')
  findOne(
    @CurrentUser() user: { id: string },
    @Param('id') id: string,
  ) {
    return this.scoresService.findOne(user.id, id);
  }

  @Get(':id/load')
  load(
    @CurrentUser() user: { id: string },
    @Param('id') id: string,
  ) {
    return this.scoresService.load(user.id, id);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: { id: string },
    @Param('id') id: string,
    @Body() dto: UpdateScoreDto,
  ) {
    return this.scoresService.update(user.id, id, dto);
  }

  @Delete(':id')
  remove(
    @CurrentUser() user: { id: string },
    @Param('id') id: string,
  ) {
    return this.scoresService.remove(user.id, id);
  }
}
