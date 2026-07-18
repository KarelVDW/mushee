import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { UpdateOnboardingDto } from './dto/update-onboarding.dto';
import { UserOnboarding } from './entities/user-onboarding.entity';

@Injectable()
export class OnboardingService {
  constructor(
    @InjectRepository(UserOnboarding)
    private readonly repo: Repository<UserOnboarding>,
  ) {}

  async get(userId: string): Promise<UserOnboarding | null> {
    return this.repo.findOneBy({ userId });
  }

  async patch(
    userId: string,
    dto: UpdateOnboardingDto,
  ): Promise<UserOnboarding> {
    const existing = await this.repo.findOneBy({ userId });
    const patch: Partial<UserOnboarding> = {};
    if (dto.background !== undefined) patch.background = dto.background;
    if (dto.goal !== undefined) patch.goal = dto.goal;
    if (dto.instruments !== undefined) patch.instruments = dto.instruments;
    if (dto.source !== undefined) patch.source = dto.source;
    if (dto.sourceDetail !== undefined) patch.sourceDetail = dto.sourceDetail;
    if (dto.completedAt !== undefined) {
      patch.completedAt = new Date(dto.completedAt);
    }

    if (existing) {
      Object.assign(existing, patch);
      return this.repo.save(existing);
    }
    return this.repo.save(this.repo.create({ userId, ...patch }));
  }

  /** Remove the user's onboarding answers (account purge). */
  async deleteForUser(userId: string): Promise<void> {
    await this.repo.delete({ userId });
  }
}
