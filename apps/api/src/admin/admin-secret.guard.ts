import { createHash, timingSafeEqual } from 'node:crypto';

import {
  CanActivate,
  ExecutionContext,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';

/**
 * Guards the admin API with the shared console secret. The admin console app
 * (apps/admin) holds the same ADMIN_SECRET and forwards it server-side as the
 * `x-admin-secret` header — it never reaches a browser. Unset ADMIN_SECRET
 * disables the whole admin surface, mirroring how missing Polar credentials
 * disable billing.
 */
@Injectable()
export class AdminSecretGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const secret = process.env.ADMIN_SECRET;
    if (!secret) {
      throw new ServiceUnavailableException(
        'Admin API is disabled — set ADMIN_SECRET to enable it.',
      );
    }

    const request = context
      .switchToHttp()
      .getRequest<{ headers: Record<string, string | string[] | undefined> }>();
    const header = request.headers['x-admin-secret'];
    const provided = Array.isArray(header) ? header[0] : header;

    // Hashing both sides gives timingSafeEqual equal-length buffers, so the
    // comparison leaks neither content nor length of the real secret.
    if (!provided || !timingSafeEqual(sha256(provided), sha256(secret))) {
      throw new UnauthorizedException('Invalid admin secret');
    }
    return true;
  }
}

function sha256(value: string): Buffer {
  return createHash('sha256').update(value).digest();
}
