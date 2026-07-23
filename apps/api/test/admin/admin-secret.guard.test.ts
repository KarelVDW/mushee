import type { ExecutionContext } from '@nestjs/common';
import {
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { afterEach, describe, expect, it } from 'vitest';

import { AdminSecretGuard } from '../../src/admin/admin-secret.guard';

function contextFor(headers: Record<string, string | string[]>): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => ({ headers }) }),
  } as unknown as ExecutionContext;
}

describe('AdminSecretGuard', () => {
  afterEach(() => {
    delete process.env.ADMIN_SECRET;
  });

  it('answers 503 when ADMIN_SECRET is not configured', () => {
    expect(() => new AdminSecretGuard().canActivate(contextFor({}))).toThrow(
      ServiceUnavailableException,
    );
  });

  it('rejects requests without the header', () => {
    process.env.ADMIN_SECRET = 'topsecret';
    expect(() => new AdminSecretGuard().canActivate(contextFor({}))).toThrow(
      UnauthorizedException,
    );
  });

  it('rejects a wrong secret', () => {
    process.env.ADMIN_SECRET = 'topsecret';
    expect(() =>
      new AdminSecretGuard().canActivate(
        contextFor({ 'x-admin-secret': 'not-it' }),
      ),
    ).toThrow(UnauthorizedException);
  });

  it('rejects a repeated header (array value) even if one entry matches', () => {
    process.env.ADMIN_SECRET = 'topsecret';
    expect(() =>
      new AdminSecretGuard().canActivate(
        contextFor({ 'x-admin-secret': ['not-it', 'topsecret'] }),
      ),
    ).toThrow(UnauthorizedException);
  });

  it('admits the configured secret', () => {
    process.env.ADMIN_SECRET = 'topsecret';
    expect(
      new AdminSecretGuard().canActivate(
        contextFor({ 'x-admin-secret': 'topsecret' }),
      ),
    ).toBe(true);
  });
});
