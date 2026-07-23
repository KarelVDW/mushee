import type { ExecutionContext } from '@nestjs/common';
import { UnauthorizedException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AuthGuard } from '../../src/auth/auth.guard';

// The real auth.config builds a better-auth instance backed by a pg Pool at
// import time; the guards only need its getSession.
const getSession = vi.fn();
vi.mock('../../src/auth/auth.config', () => ({
  auth: { api: { get getSession() { return getSession; } } },
}));

function contextFor(request: Record<string, unknown>): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

const session = {
  user: { id: 'u1', email: 'a@b.c', role: 'user' },
  session: { id: 's1' },
};

beforeEach(() => {
  getSession.mockReset();
});

describe('AuthGuard', () => {
  it('rejects requests without a session', async () => {
    getSession.mockResolvedValue(null);
    await expect(
      new AuthGuard().canActivate(contextFor({ headers: {} })),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('stamps user and session on the request when authenticated', async () => {
    getSession.mockResolvedValue(session);
    const request: Record<string, unknown> = { headers: { cookie: 'x' } };
    await expect(
      new AuthGuard().canActivate(contextFor(request)),
    ).resolves.toBe(true);
    expect(request.user).toBe(session.user);
    expect(request.session).toBe(session.session);
  });
});
