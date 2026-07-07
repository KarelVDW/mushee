import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { fromNodeHeaders } from 'better-auth/node';
import type { IncomingHttpHeaders } from 'http';

import { auth } from './auth';

/** The request shape the auth layer works with: incoming headers, plus the
 *  user/session it stamps on for downstream guards and @CurrentUser. */
export interface AuthenticatedRequest {
  headers: IncomingHttpHeaders;
  user?: typeof auth.$Infer.Session.user;
  session?: typeof auth.$Infer.Session.session;
}

@Injectable()
export class AuthGuard implements CanActivate {
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();

    const session = await auth.api.getSession({
      headers: fromNodeHeaders(request.headers),
    });

    if (!session) {
      throw new UnauthorizedException();
    }

    request.user = session.user;
    request.session = session.session;
    return true;
  }
}
