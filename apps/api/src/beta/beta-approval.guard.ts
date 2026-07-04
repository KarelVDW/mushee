import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';

import { BetaService } from './beta.service';

/**
 * Blocks users whose beta signup hasn't been approved yet. A no-op when
 * BETA_MODE is off or the user predates the beta (betaStatus null).
 * Must run after AuthGuard: `@UseGuards(AuthGuard, BetaApprovalGuard)`.
 */
@Injectable()
export class BetaApprovalGuard implements CanActivate {
  constructor(private readonly betaService: BetaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<{ user?: { id: string } }>();
    const user = request.user;
    if (!user) return false;

    if (await this.betaService.isAwaitingApproval(user.id)) {
      throw new ForbiddenException({
        code: 'beta-pending',
        message: 'Your beta access is awaiting approval.',
      });
    }
    return true;
  }
}
