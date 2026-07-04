import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { fromNodeHeaders } from 'better-auth/node';

import { auth } from './auth';

/** AuthGuard + role check: only users with role 'admin' get through. */
@Injectable()
export class AdminGuard implements CanActivate {
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context
      .switchToHttp()
      .getRequest<{ headers: Record<string, string>; user?: unknown; session?: unknown }>();

    const session = await auth.api.getSession({
      headers: fromNodeHeaders(request.headers),
    });

    if (!session) {
      throw new UnauthorizedException();
    }
    if ((session.user as { role?: string }).role !== 'admin') {
      throw new ForbiddenException('Admin access required');
    }

    request.user = session.user;
    request.session = session.session;
    return true;
  }
}
