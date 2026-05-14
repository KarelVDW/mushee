import { Body, Controller, Get, Patch, UseGuards } from '@nestjs/common';

import { AuthGuard } from '../auth/auth.guard';
import { CurrentUser } from '../auth/user.decorator';
import { UpdateOnboardingDto } from './dto/update-onboarding.dto';
import { OnboardingService } from './onboarding.service';

@Controller('onboarding')
@UseGuards(AuthGuard)
export class OnboardingController {
  constructor(private readonly onboardingService: OnboardingService) {}

  @Get()
  get(@CurrentUser() user: { id: string }) {
    return this.onboardingService.get(user.id);
  }

  @Patch()
  patch(
    @CurrentUser() user: { id: string },
    @Body() dto: UpdateOnboardingDto,
  ) {
    return this.onboardingService.patch(user.id, dto);
  }
}
