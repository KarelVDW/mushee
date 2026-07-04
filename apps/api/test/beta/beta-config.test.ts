import { afterEach, describe, expect, it } from 'vitest';

import {
  adminEmails,
  isAdminEmail,
  isBetaMode,
  signupTierId,
  signupUserFields,
} from '../../src/beta/beta-config';

const ORIGINAL_ENV = { ...process.env };

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe('beta switches', () => {
  it('is off unless BETA_MODE is exactly "true"', () => {
    delete process.env.BETA_MODE;
    expect(isBetaMode()).toBe(false);
    process.env.BETA_MODE = 'false';
    expect(isBetaMode()).toBe(false);
    process.env.BETA_MODE = '1';
    expect(isBetaMode()).toBe(false);
    process.env.BETA_MODE = 'true';
    expect(isBetaMode()).toBe(true);
  });

  it('parses ADMIN_EMAILS case-insensitively', () => {
    process.env.ADMIN_EMAILS = ' Karel@Example.com, admin@sheemu.app ,,';
    expect(adminEmails()).toEqual(['karel@example.com', 'admin@sheemu.app']);
    expect(isAdminEmail('KAREL@example.COM')).toBe(true);
    expect(isAdminEmail('someone@else.com')).toBe(false);
  });

  it('stamps regular signups: free tier + no beta status outside the beta', () => {
    process.env.BETA_MODE = 'false';
    delete process.env.ADMIN_EMAILS;
    expect(signupUserFields('user@example.com')).toEqual({ role: 'user', betaStatus: null });
    expect(signupTierId()).toBe('free');
  });

  it('stamps beta signups: beta tier + pending status', () => {
    process.env.BETA_MODE = 'true';
    delete process.env.ADMIN_EMAILS;
    expect(signupUserFields('user@example.com')).toEqual({ role: 'user', betaStatus: 'pending' });
    expect(signupTierId()).toBe('beta');
  });

  it('auto-approves admins and grants the admin role', () => {
    process.env.BETA_MODE = 'true';
    process.env.ADMIN_EMAILS = 'karel@example.com';
    expect(signupUserFields('karel@example.com')).toEqual({ role: 'admin', betaStatus: 'approved' });

    process.env.BETA_MODE = 'false';
    expect(signupUserFields('karel@example.com')).toEqual({ role: 'admin', betaStatus: null });
  });
});
